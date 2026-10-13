# One image definition for the whole monorepo, with two targets:
#   docker build --target api .   and   docker build --target web .
# docker-compose.yml builds both.

FROM node:24-bookworm-slim AS deps
# Prisma's migration engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# Manifests first, so `npm install` is cached until a dependency changes.
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm install --no-audit --no-fund
COPY . .
# prisma.config.ts requires DATABASE_URL even to generate code; any value works here.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate

# ---- API: migrate + seed (both idempotent), then serve on :4000 ----
FROM deps AS api
ENV NODE_ENV=development PORT=4000
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && npm run start -w @railway/api"]

# ---- Web: production build; /api/* is proxied to the api service ----
FROM deps AS web
# Rewrites are resolved at build time, so the API address is a build argument.
ARG API_ORIGIN=http://api:4000
ENV API_ORIGIN=$API_ORIGIN NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @railway/web
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@railway/web"]
