FROM node:22-bookworm-slim AS build

WORKDIR /app/services
COPY services/package*.json ./
RUN npm ci

COPY services ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV YFINANCE_PYTHON=/opt/yfinance-venv/bin/python
WORKDIR /app/services

COPY services/package*.json ./
RUN npm ci --omit=dev

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY services/requirements-yfinance.txt ./
RUN python3 -m venv /opt/yfinance-venv \
  && /opt/yfinance-venv/bin/pip install --no-cache-dir -r requirements-yfinance.txt

COPY --from=build /app/services/dist ./dist
COPY --from=build /app/services/research-db/src/migrations ./dist/research-db/src/migrations
COPY --from=build /app/services/scripts ./scripts

EXPOSE 3001
CMD ["node", "dist/gateway-v2/src/index.js"]
