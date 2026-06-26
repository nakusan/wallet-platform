FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY shared/canonical ./shared/canonical
COPY aggregator ./aggregator
RUN pnpm install --filter wallet-aggregator...
RUN pnpm --filter wallet-aggregator build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/aggregator/dist ./dist
COPY --from=build /app/aggregator/package.json ./
COPY --from=build /app/aggregator/migrations ./migrations
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/main.js"]
