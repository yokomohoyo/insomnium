# Build from the repository root:
#   docker build -f packages/insomnium-server/Dockerfile -t insomnium-server .
# by digest, so a retagged image can't slip into a build (Dependabot moves it)
FROM node:26-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39 AS build
WORKDIR /src
# the bundle needs no Electron; libcurl's install still fetches its prebuilt binary
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY . .
# node-libcurl's package and prebuilt binary come from GitHub Releases, which
# answer 504 now and then: npm retries its fetches, and the install is tried
# up to three times
ENV npm_config_fetch_retries=5 npm_config_fetch_retry_mintimeout=10000 npm_config_fetch_retry_maxtimeout=60000
RUN for attempt in 1 2 3; do npm ci --no-audit --no-fund && break; [ "$attempt" = 3 ] && exit 1; sleep $((attempt * 30)); done   && npm run build:server --workspace=packages/insomnia

FROM node:26-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39
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
# over HTTPS when it serves its own certificate, which needn't name 127.0.0.1
HEALTHCHECK CMD node -e "require(process.env.INSOMNIUM_TLS_CERT ? 'https' : 'http').get({ host: '127.0.0.1', port: process.env.INSOMNIUM_PORT, path: '/health', rejectUnauthorized: false }, r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
ENTRYPOINT ["node", "/app/dist/index.js"]
