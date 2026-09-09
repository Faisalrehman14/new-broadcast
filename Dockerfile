# CastMe Pro — shared production image (api, worker, web).
# Railway services all use /Dockerfile with no dockerBuildTarget and ignore
# apps/*/railway.json (fileServiceManifest is empty). One image must serve all.
FROM node:20-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS deps
# Keep install in development so typescript (devDep) is present even when Railway sets NODE_ENV=production.
ENV NODE_ENV=development
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/types/package.json packages/types/
COPY packages/validation/package.json packages/validation/
COPY packages/config/package.json packages/config/
COPY packages/meta-provider/package.json packages/meta-provider/
RUN npm ci --ignore-scripts --include=dev

FROM deps AS build
# Critical: if NODE_ENV stays "development", Next.js prerender mixes prod/dev
# runtimes → TypeError: Cannot read properties of null (reading 'useContext').
ENV NODE_ENV=production
COPY . .
RUN npm run build -w @pagebroadcast/types \
 && npm run build -w @pagebroadcast/config \
 && npm run build -w @pagebroadcast/validation \
 && npm run build -w @pagebroadcast/meta-provider \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w @pagebroadcast/api \
 && npm run build -w @pagebroadcast/worker \
 && npm run build -w @pagebroadcast/web \
 && test -f apps/api/dist/server.js \
 && test -f apps/worker/dist/index.js \
 && ls -la apps/api/dist/server.js apps/worker/dist/index.js

FROM base AS production
COPY --from=build /app /app
WORKDIR /app
ENV NODE_ENV=production
EXPOSE 3000 4000
# Overridden per service by Railway startCommand.
CMD ["npm", "run", "start", "--workspace=@pagebroadcast/api"]
