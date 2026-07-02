FROM node:22-alpine

# --- Chromium for PDF export (used by html-pdf-node / puppeteer) ---
# Puppeteer's own bundled Chromium download does NOT work reliably on
# Alpine (musl libc), which is why "Export PDF" fails in this image.
# Fix: install Alpine's native Chromium build and point Puppeteer at it,
# skipping its own (incompatible) download entirely.
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
  && ln -sf "$(command -v chromium || command -v chromium-browser)" /usr/local/bin/chromium-browser

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/local/bin/chromium-browser

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/database.db

CMD ["node", "server.js"]
