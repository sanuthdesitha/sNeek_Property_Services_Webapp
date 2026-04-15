FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y \
  ca-certificates \
  ffmpeg \
  openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
ENV NEXT_DIST_DIR=.next-prod

RUN npx prisma generate
RUN npx prisma migrate deploy
RUN npx playwright install --with-deps chromium
RUN node ./scripts/run-next.cjs build

EXPOSE 3000

CMD ["npm", "run", "start"]
