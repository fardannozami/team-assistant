FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/naya ./apps/naya
COPY packages ./packages
RUN bun install --frozen-lockfile
# Baked into the bundle at build time: the public URLs of the API and of the dashboard.
ARG VITE_API_URL=http://localhost:4000
ARG VITE_DAILY_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL VITE_DAILY_URL=$VITE_DAILY_URL
WORKDIR /app/apps/naya
RUN bunx vite build

FROM nginx:alpine
COPY --from=build /app/apps/naya/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
