FROM node:22-bookworm-slim AS build

WORKDIR /app/services
COPY services/package*.json ./
RUN npm ci

COPY services ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app/services

COPY services/package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/services/dist ./dist
COPY --from=build /app/services/research-db/src/migrations ./dist/research-db/src/migrations

EXPOSE 3001
CMD ["node", "dist/gateway-v2/src/index.js"]
