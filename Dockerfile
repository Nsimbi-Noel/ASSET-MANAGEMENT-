FROM node:22-alpine

# PDF export is implemented with pdf-lib (pure JavaScript) — it does not
# require Chromium/Puppeteer, so we keep the image small and avoid installing
# heavy browser dependencies that were previously declared but unused.

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data

EXPOSE 3000

ENV PORT=3000
ENV DB_PATH=/app/data/database.db

CMD ["node", "server.js"]
