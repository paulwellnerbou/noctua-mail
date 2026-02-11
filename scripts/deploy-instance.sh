#!/bin/bash
set -e

# Deploy a specific instance (dev or prod) to the VPS WITHOUT git checkout
# This script is designed to be piped via SSH from CI/CD
# Usage: ssh user@host "bash -s" < deploy-instance.sh <instance> <image_tag>
# 
# ```bash
# Manual deployment from local machine
# ssh root@YOUR_VPS_IP 'bash -s' < scripts/deploy-instance.sh dev latest
# ssh root@YOUR_VPS_IP 'bash -s' < scripts/deploy-instance.sh prod latest
# ```

INSTANCE=${1:-dev}  # dev or prod
IMAGE_TAG=${2:-latest}
DEPLOY_PATH=${DEPLOY_PATH:-/opt/noctua-mail}
REGISTRY=${REGISTRY:-ghcr.io}
IMAGE_NAME=${IMAGE_NAME:-$GITHUB_REPOSITORY}
FULL_IMAGE="$REGISTRY/$IMAGE_NAME:$IMAGE_TAG"

# Validate instance
if [[ "$INSTANCE" != "dev" && "$INSTANCE" != "prod" ]]; then
  echo "Error: Instance must be 'dev' or 'prod'"
  exit 1
fi

echo "=========================================="
echo "Deploying Noctua Mail - $INSTANCE"
echo "Image: $FULL_IMAGE"
echo "=========================================="

# Create deployment directory
mkdir -p "$DEPLOY_PATH/data-$INSTANCE"

# Ensure proper permissions for the noctua user in the container
# The noctua user has UID 999 (created with useradd -r in Dockerfile)
chown -R 999:999 "$DEPLOY_PATH/data-$INSTANCE"

cd "$DEPLOY_PATH"

# Login to container registry
if [[ -n "$GITHUB_TOKEN" ]]; then
  echo "Logging in to $REGISTRY..."
  echo "$GITHUB_TOKEN" | docker login "$REGISTRY" -u "$GITHUB_ACTOR" --password-stdin 2>/dev/null || echo "Warning: Registry login failed"
fi

# Pull the new image
echo "Pulling Docker image..."
docker pull "$FULL_IMAGE"

# Stop and remove old container if exists
echo "Stopping old container..."
docker stop noctua-mail-$INSTANCE 2>/dev/null || true
docker rm noctua-mail-$INSTANCE 2>/dev/null || true

# Load environment variables from file (if exists)
ENV_FILE="$DEPLOY_PATH/.env.$INSTANCE"
if [[ -f "$ENV_FILE" ]]; then
  echo "Loading environment from $ENV_FILE"
  set -a
  source "$ENV_FILE"
  set +a
else
  echo "Warning: $ENV_FILE not found, using defaults"
fi

# Start new container
echo "Starting new container..."
docker run -d \
  --name noctua-mail-$INSTANCE \
  --restart unless-stopped \
  --network noctua-net \
  -v "$DEPLOY_PATH/data-$INSTANCE:/app/.data" \
  -e PORT=3654 \
  -e NOCTUA_DATA_DIR=/app/.data/ \
  -e SESSION_SEAL_KEY="${SESSION_SEAL_KEY:-}" \
  -e IMAP_SECRET_KEY="${IMAP_SECRET_KEY:-}" \
  -e IMAP_CREDENTIALS_STORAGE="${IMAP_CREDENTIALS_STORAGE:-both}" \
  "$FULL_IMAGE"

# Wait for container to be healthy
echo "Waiting for container to start..."
sleep 5

# Check container status
if docker ps | grep -q "noctua-mail-$INSTANCE"; then
  echo "✅ Deployment successful!"
  docker ps | grep "noctua-mail-$INSTANCE"
else
  echo "❌ Deployment failed! Container is not running."
  docker logs --tail=50 noctua-mail-$INSTANCE
  exit 1
fi

# Show recent logs
echo ""
echo "Recent logs:"
docker logs --tail=20 noctua-mail-$INSTANCE

# Clean up old images (keep last 3 versions)
echo ""
echo "Cleaning up old images..."
docker images "$REGISTRY/$IMAGE_NAME" --format "{{.ID}}" | tail -n +4 | xargs -r docker rmi -f 2>/dev/null || true

echo ""
echo "=========================================="
echo "✅ $INSTANCE deployment complete!"
echo "Container: noctua-mail-$INSTANCE"
echo "Image: $FULL_IMAGE"
echo "=========================================="
