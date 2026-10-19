# Reproducible local dependency/runtime image; Compose overlays development source.
# No host node_modules or environment files are copied. Electron remains native.
FROM oven/bun:1.3.14-debian AS bun
FROM node:24-bookworm-slim
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY . .
RUN bun install --frozen-lockfile && mkdir -p apps/web/.next && chown -R node:node /app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /home/node/.config/freecoda && chown -R node:node /home/node/.config
USER node
EXPOSE 3010
CMD ["bun", "scripts/docker-web.ts"]
