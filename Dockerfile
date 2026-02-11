# Noctua Mail Dockerfile
FROM oven/bun:1.1.42-debian AS base
WORKDIR /app

# Install dependencies (with cache mount for faster rebuilds)
FROM base AS deps
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# Build the application
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set build-time environment variables
ENV NEXT_TELEMETRY_DISABLED=1

# Build Next.js
RUN bun run build

# Production image
FROM base AS runner

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN groupadd -r noctua && useradd -r -g noctua noctua

# Copy built application
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Create data directory with proper permissions
RUN mkdir -p /app/.data && chown -R noctua:noctua /app

# Switch to non-root user
USER noctua

# Expose port
EXPOSE 3654

# Set default environment variables
ENV PORT=3654
ENV NOCTUA_DATA_DIR=/app/.data/

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD bun --bun -e "fetch('http://localhost:3654/').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["bun", "--bun", "server.js"]
