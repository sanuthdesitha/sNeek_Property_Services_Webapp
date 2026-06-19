FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y \
  ca-certificates \
  ffmpeg \
  openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
# Retry npm ci: esbuild's post-install can hit a transient ETXTBSY ("text file
# busy") in Docker when it execs its just-written binary under load. Each npm ci
# reinstalls node_modules from scratch, so retrying is safe and idempotent.
RUN npm ci --no-audit --no-fund \
  || (echo "npm ci failed, retrying (1/2)..." && sleep 3 && npm ci --no-audit --no-fund) \
  || (echo "npm ci failed, retrying (2/2)..." && sleep 5 && npm ci --no-audit --no-fund)

# Chromium for server-side PDF rendering (lib/reports/pdf.ts uses Playwright).
# Done BEFORE copying source so this slow step (browser download + ~80 apt deps)
# is cached and only re-runs when dependencies change — not on every code edit.
RUN npx playwright install --with-deps chromium

COPY . .

ENV NODE_ENV=production
ENV NEXT_DIST_DIR=.next-prod

RUN npx prisma generate
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
