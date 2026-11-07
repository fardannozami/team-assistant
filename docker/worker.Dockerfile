FROM oven/bun:1.4.2 AS base
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/worker/package.json apps/worker/
COPY packages ./packages
RUN bun install --frozen-lockfile

COPY apps/worker ./apps/worker
COPY turbo.json ./

WORKDIR /app/apps/worker
CMD ["bun", "run", "src/index.ts"]