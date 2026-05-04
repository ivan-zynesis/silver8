# syntax=docker/dockerfile:1.7
# Coinbase mock — small WS server replaying captured fixtures, with a control
# plane for fault injection. Used by the integration test suite (DEC-029).

# ----- Stage 1: deps + build (uses workspace root for shared lockfile) -----
FROM node:20-bookworm-slim AS build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@8.15.0 --activate

# Copy workspace manifests for resolution. We only need the mock package and
# its (currently zero) workspace deps, but pnpm wants the lockfile + workspace
# config to resolve.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/coinbase-mock/package.json ./apps/coinbase-mock/
COPY apps/hub/package.json ./apps/hub/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY packages/core/package.json ./packages/core/
COPY packages/core-memory/package.json ./packages/core-memory/
COPY packages/observability/package.json ./packages/observability/
COPY packages/ingestion/package.json ./packages/ingestion/
COPY packages/gateway-ws/package.json ./packages/gateway-ws/
COPY packages/mcp-server/package.json ./packages/mcp-server/

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @silver8/coinbase-mock...

# Copy mock source + base tsconfig (required by the package tsconfig).
COPY tsconfig.base.json ./
COPY apps/coinbase-mock ./apps/coinbase-mock

RUN pnpm --filter @silver8/coinbase-mock build

# Strip dev deps for the runtime image.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @silver8/coinbase-mock...

# ----- Stage 2: runtime -----
FROM gcr.io/distroless/nodejs20-debian12 AS runtime
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/coinbase-mock/dist ./apps/coinbase-mock/dist
COPY --from=build /app/apps/coinbase-mock/fixtures ./apps/coinbase-mock/fixtures
COPY --from=build /app/apps/coinbase-mock/package.json ./apps/coinbase-mock/package.json
COPY --from=build /app/package.json ./package.json

ENV NODE_ENV=production \
    MOCK_WS_PORT=8765 \
    MOCK_CONTROL_PORT=8766 \
    MOCK_LOOP=true \
    MOCK_RATE_HZ=10

EXPOSE 8765 8766

CMD ["apps/coinbase-mock/dist/main.js"]
