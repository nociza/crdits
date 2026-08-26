FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    CRDITS_HOST=127.0.0.1 \
    CRDITS_PORT=8788 \
    CRDITS_DB_PATH=/data/crdits.sqlite \
    CRDITS_CATALOG_DIR=/app/catalog/cards
COPY --from=build /app /app
VOLUME ["/data"]
EXPOSE 3000
CMD ["npm", "start"]
