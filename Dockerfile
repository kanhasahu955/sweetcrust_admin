# SweetCrust Admin (Nuxt 4) — production image
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Baked into client bundle (also overridable at runtime via NUXT_PUBLIC_*)
ARG NUXT_PUBLIC_API_BASE=https://api.skbakery.in
ARG NUXT_PUBLIC_SOCKET_BASE=https://api.skbakery.in
ENV NUXT_PUBLIC_API_BASE=$NUXT_PUBLIC_API_BASE \
    NUXT_PUBLIC_SOCKET_BASE=$NUXT_PUBLIC_SOCKET_BASE \
    NITRO_PRESET=node-server
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache wget
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000
COPY --from=build /app/.output ./.output
EXPOSE 3000
USER node
CMD ["node", ".output/server/index.mjs"]
