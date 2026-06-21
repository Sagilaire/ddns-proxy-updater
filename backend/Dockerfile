# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-alpine
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    PORT=4010

# Create a non-root user to run the app
RUN addgroup -S app && adduser -S app -G app && \
    mkdir -p /app/data && chown -R app:app /app

WORKDIR /app

COPY --from=deps --chown=app:app /app/node_modules ./node_modules
COPY --chown=app:app package.json ./
COPY --chown=app:app src ./src

USER app

EXPOSE 4010

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 || exit 1

CMD ["node", "src/server.js"]
