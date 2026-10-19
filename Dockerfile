FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# The one-off migrator (ADR 0001, unit D11). Next's standalone output trims node_modules, so node-pg-migrate runs
# from this stage instead. It also carries the demo seed (db/seed/demo.ts), which runs as cbs_owner too.
# deploy/deploy-remote.sh runs it with DATABASE_MIGRATE_URL before it swaps the app container.
FROM deps AS migrator
ENV NODE_ENV=production
COPY db ./db
USER node
CMD ["node", "node_modules/node-pg-migrate/bin/node-pg-migrate.js", "up", "-m", "db/migrations", "-d", "DATABASE_MIGRATE_URL"]

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CLIENT_BILLING_CHROMIUM_NO_SANDBOX=1
# Invoice PDFs are printed by headless Chromium. This installs the browser and the system libraries and fonts it needs.
COPY --from=deps /app/node_modules/playwright-core /opt/playwright-core
RUN node /opt/playwright-core/cli.js install --with-deps chromium-headless-shell \
    && rm -rf /opt/playwright-core /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
CMD ["node", "server.js"]
