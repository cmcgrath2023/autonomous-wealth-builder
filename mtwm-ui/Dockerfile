FROM node:22-bookworm-slim AS build

WORKDIR /app/mtwm-ui
COPY mtwm-ui/package*.json ./
RUN npm ci

COPY mtwm-ui ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app/mtwm-ui

COPY mtwm-ui/package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/mtwm-ui/.next ./.next
COPY --from=build /app/mtwm-ui/public ./public
COPY --from=build /app/mtwm-ui/next.config.ts ./next.config.ts

EXPOSE 3000
CMD ["npm", "run", "start"]
