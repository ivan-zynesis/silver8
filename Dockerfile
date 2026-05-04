# syntax=docker/dockerfile:1.7
# Multi-stage build for the silver8 market data hub.
# Final image is distroless to minimise attack surface.

# ----- Stage 1: deps -----
FROM node:20-bookworm-slim AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy workspace manifests for dependency resolution.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/hub/package.json ./apps/hub/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY packages/core/package.json ./packages/core/
COPY packages/core-memory/package.json ./packages/core-memory/
COPY packages/observability/package.json ./packages/observability/
COPY packages/ingestion/package.json ./packages/ingestion/
COPY packages/gateway-ws/package.json ./packages/gateway-ws/
COPY packages/mcp-server/package.json ./packages/mcp-server/

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# ----- Stage 2: build -----
FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./
COPY turbo.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm build

# Strip dev dependencies from node_modules for the runtime image.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ----- Stage 3: runtime -----
FROM gcr.io/distroless/nodejs20-debian12 AS runtime
WORKDIR /app

# Copy only what's needed at runtime: built dist + production node_modules + workspace symlinks.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/hub/dist ./apps/hub/dist
COPY --from=build /app/apps/hub/package.json ./apps/hub/package.json
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/core-memory/dist ./packages/core-memory/dist
COPY --from=build /app/packages/core-memory/package.json ./packages/core-memory/package.json
COPY --from=build /app/packages/observability/dist ./packages/observability/dist
COPY --from=build /app/packages/observability/package.json ./packages/observability/package.json
COPY --from=build /app/packages/ingestion/dist ./packages/ingestion/dist
COPY --from=build /app/packages/ingestion/package.json ./packages/ingestion/package.json
COPY --from=build /app/packages/gateway-ws/dist ./packages/gateway-ws/dist
COPY --from=build /app/packages/gateway-ws/package.json ./packages/gateway-ws/package.json
COPY --from=build /app/packages/mcp-server/dist ./packages/mcp-server/dist
COPY --from=build /app/packages/mcp-server/package.json ./packages/mcp-server/package.json
# Dashboard SPA static assets — served by the hub at /dashboard/*.
COPY --from=build /app/apps/dashboard/dist ./apps/dashboard/dist
COPY --from=build /app/package.json ./package.json

ENV NODE_ENV=production \
    HTTP_PORT=3000 \
    WS_PORT=3001 \
    MODE=monolith \
    MCP_TRANSPORT=http

EXPOSE 3000 3001

# Distroless nodejs entrypoint expects the JS file as arg[0].
CMD ["apps/hub/dist/main.js"]
