# ---------------------------------------------------------------------------
# nodeward — production image
#
# Two stages: the first builds the client bundle, the second is the runtime
# with only the server's production dependencies (express — the server runs
# its .ts sources directly, there is no server build). State lives in /data
# (sqlite file + logs), so that is the one volume to mount and back up.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --omit=dev -w server && npm cache clean --force

COPY server/src server/src
COPY shared shared
COPY --from=build /app/client/dist client/dist

# state (sqlite + logs) in one place, owned by the unprivileged user
RUN mkdir -p /data && chown -R node:node /data
USER node
ENV SQLITE_PATH=/data/nodeward.db \
    LOG_DIR=/data/logs \
    PORT=4001

EXPOSE 4001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:4001/healthz || exit 1

CMD ["node", "--experimental-strip-types", "server/src/index.ts"]
