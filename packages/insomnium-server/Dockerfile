# Build from the repository root:
#   docker build -f packages/insomnium-server/Dockerfile -t insomnium-server .
FROM node:24-slim AS build
WORKDIR /src
# the bundle needs no Electron; libcurl's install still fetches its prebuilt binary
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY . .
RUN npm ci --no-audit --no-fund && npm run build:server --workspace=packages/insomnia

FROM node:24-slim
ENV NODE_ENV=production \
    INSOMNIUM_HOST=0.0.0.0 \
    INSOMNIUM_PORT=8080
WORKDIR /app
# git, for the team server (`team`), which serves its collections with git's http-backend
RUN apt-get update   && apt-get install -y --no-install-recommends git ca-certificates   && rm -rf /var/lib/apt/lists/*   && mkdir /data && chown node:node /data
# one bundle, libcurl's native binding beside it, and the proto worker
COPY --from=build /src/packages/insomnium-server/dist ./dist
USER node
# the team server's accounts and repositories
VOLUME /data
EXPOSE 8080
HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:' + process.env.INSOMNIUM_PORT + '/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["node", "/app/dist/index.js"]
