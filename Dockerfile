# Noctua Mail Dockerfile
FROM oven/bun:1.3.12-debian AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Build the application
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set build-time environment variables
ENV NEXT_TELEMETRY_DISABLED=1
ENV NOCTUA_STATIC_APP_TITLE=__NOCTUA_APP_TITLE__
ARG NOCTUA_BUILD_HASH
ARG NOCTUA_BUILD_TIME
ENV NEXT_PUBLIC_BUILD_HASH=$NOCTUA_BUILD_HASH
ENV NEXT_PUBLIC_BUILD_TIME=$NOCTUA_BUILD_TIME

# Build Next.js with Turbopack
RUN bun run build

# Production image - uses standalone output
FROM base AS runner

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user with fixed UID/GID for consistent permissions
RUN groupadd -g 999 noctua && useradd -u 999 -g noctua -s /bin/bash noctua

# Copy standalone build output (minimal, tree-shaken dependencies)
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY build-scripts/generateRuntimeConfig.ts /app/build-scripts/generateRuntimeConfig.ts
COPY deploy-scripts/container-entrypoint.sh /app/entrypoint.sh

# Create data directory with proper permissions
RUN chmod +x /app/entrypoint.sh && mkdir -p /app/.data && chown -R noctua:noctua /app

# Switch to non-root user
USER noctua

# Expose port
EXPOSE 3654

# Set default environment variables
ENV PORT=3654
# Next standalone binds to HOSTNAME; Docker injects the container ID there,
# which binds eth0 only and makes loopback (and the healthcheck) unreachable.
ENV HOSTNAME=0.0.0.0
ENV NOCTUA_DATA_DIR=/app/.data/
ENV APP_ENV_LABEL=

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD bun --bun -e "const r = await fetch('http://127.0.0.1:' + (process.env.PORT || 3654) + '/api/version'); if (!r.ok) { console.error('unhealthy: HTTP ' + r.status); process.exit(1); } process.exit(0);"

# Generate runtime config and run standalone server
CMD ["/app/entrypoint.sh"]
