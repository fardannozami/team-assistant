FROM oven/bun:1.4.2 AS base
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY packages ./packages
RUN bun install --frozen-lockfile

COPY apps/api ./apps/api
COPY turbo.json ./

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["bun", "run", "src/index.ts"]