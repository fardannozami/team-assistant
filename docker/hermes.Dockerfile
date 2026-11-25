# Hermes Agent (official image, pinned) plus hermes-bridge, supervised by the image's s6-overlay.
# Data (profiles, memory, skills, sessions, kanban.db, .env with model keys) lives in /opt/data,
# a volume, so upgrading this image keeps it. See docs/naya.md.

FROM oven/bun:1.4.2 AS bridge
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/hermes-bridge ./apps/hermes-bridge
COPY packages ./packages
RUN bun install --frozen-lockfile
WORKDIR /app/apps/hermes-bridge
# A single self-contained binary: the Hermes image needs no Bun or Node for it.
RUN bun build src/index.ts --compile --target=bun-linux-x64 --outfile /hermes-bridge

# v0.23.3 is the "stable" tag as of 2026-11-20; bump both together.
FROM nousresearch/hermes-agent:v0.23.3@sha256:3e9fe4c6ef36490f43aa0d0d80f9df64e9c92a576eee3042f1a97c8813c05355
COPY --from=bridge /hermes-bridge /usr/local/bin/hermes-bridge
COPY docker/hermes/s6-rc.d/ /etc/s6-overlay/s6-rc.d/
EXPOSE 8700
CMD ["gateway", "run"]
