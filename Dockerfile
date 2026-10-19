FROM node:20-alpine

RUN apk add --no-cache ca-certificates

WORKDIR /app

# Create persistent data directory for config and ID mapping cache
RUN mkdir -p /data && chmod 777 /data

COPY package.json ./
COPY src ./src
COPY public ./public
COPY server.js ./

ENV NODE_ENV=production
ENV NODE_OPTIONS="--dns-result-order=ipv4first"
ENV PORT=3000
ENV DATA_DIR=/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
