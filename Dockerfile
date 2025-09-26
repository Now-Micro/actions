# syntax=docker/dockerfile:1.7

# --- Builder stage -----------------------------------------------------------
FROM node:22.9.0-alpine3.19 AS builder
WORKDIR /app

# Copy manifests first for better caching
COPY mcp/package.json mcp/tsconfig.json ./

# Install all dependencies (dev included for building)
RUN npm install --no-audit --no-fund

# Copy sources
COPY mcp/src ./src

# Build TypeScript
RUN npx tsc -p .

# Prune dev dependencies for runtime
RUN npm prune --omit=dev

# --- Runtime stage -----------------------------------------------------------
FROM node:22.9.0-alpine3.19 AS runner
ENV NODE_ENV=production
WORKDIR /app

# Create non-root user
RUN addgroup -S app && adduser -S app -G app

# Copy only runtime artifacts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Drop privileges
USER app

# MCP servers generally use stdio transport; expose nothing by default
ENTRYPOINT ["node","dist/index.js"]
