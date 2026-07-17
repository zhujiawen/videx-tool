FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PYTHON_BIN=python3

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server
COPY server/requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/ ./

EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["npm", "start"]
