FROM node:22-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/web ./apps/web
COPY packages ./packages
RUN npm install -g bun && bun install --frozen-lockfile
WORKDIR /app/apps/web
RUN bun run build

FROM nginx:alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]