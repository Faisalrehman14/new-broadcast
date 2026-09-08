# CastMe Pro — multi-stage production images
# API/worker targets skip Next.js so Railway API deploys are not blocked by web OOM/timeouts.
FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/types/package.json packages/types/
COPY packages/validation/package.json packages/validation/
COPY packages/config/package.json packages/config/
COPY packages/meta-provider/package.json packages/meta-provider/
# ignore-scripts: never run local-only postinstalls (e.g. redis-memory-server)
RUN npm ci --ignore-scripts

FROM deps AS build-backend
COPY . .
RUN npm run build -w @pagebroadcast/types \
 && npm run build -w @pagebroadcast/config \
 && npm run build -w @pagebroadcast/validation \
 && npm run build -w @pagebroadcast/meta-provider \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w @pagebroadcast/api \
 && npm run build -w @pagebroadcast/worker

FROM deps AS build-web
COPY . .
RUN npm run build -w @pagebroadcast/types \
 && npm run build -w @pagebroadcast/config \
 && npm run build -w @pagebroadcast/validation \
 && npm run build -w @pagebroadcast/meta-provider \
 && npm run build -w @pagebroadcast/web

# Full build (optional / local)
FROM build-backend AS build
RUN npm run build -w @pagebroadcast/web

FROM base AS api
COPY --from=build-backend /app /app
WORKDIR /app
ENV NODE_ENV=production
EXPOSE 4000
CMD ["npm", "run", "start:prod", "-w", "@pagebroadcast/api"]

FROM base AS worker
COPY --from=build-backend /app /app
WORKDIR /app
ENV NODE_ENV=production
CMD ["node", "apps/worker/dist/index.js"]

FROM base AS web
COPY --from=build-web /app /app
WORKDIR /app/apps/web
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start"]
