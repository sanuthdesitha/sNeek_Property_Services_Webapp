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
RUN npx playwright install --with-deps chromium
RUN node ./scripts/run-next.cjs build

EXPOSE 3000

# NOTE: Migrations are NO LONGER part of the container startup.
# Running `prisma migrate deploy` here meant every preview/replica/restart
# fought for the same DB lock — sustained CPU thrash on shared-vCPU VPS hosts.
#
# Run migrations manually as a one-shot before deploying:
#   docker run --rm --env-file=.env <this-image> npx prisma migrate deploy
# Or via package.json:
#   npm run db:deploy
# See docs/ops/vps-triage.md §14.
CMD ["npm", "run", "start"]
