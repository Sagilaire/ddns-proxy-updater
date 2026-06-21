# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY tsconfig.json ./
RUN npm install --no-audit --no-fund
COPY src ./src
RUN npm run build

FROM node:20-alpine
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    PORT=4010

# Create a non-root user to run the app
RUN addgroup -S app && adduser -S app -G app && \
    mkdir -p /app/data && chown -R app:app /app

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build --chown=app:app /app/dist ./dist

USER app

EXPOSE 4010

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 || exit 1

CMD ["node", "dist/server.js"]
