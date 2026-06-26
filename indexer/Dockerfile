FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY shared/canonical ./shared/canonical
COPY indexer ./indexer
RUN pnpm install --filter wallet-indexer...
RUN pnpm --filter wallet-indexer build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/indexer/dist ./dist
COPY --from=build /app/indexer/package.json ./
COPY --from=build /app/indexer/migrations ./migrations
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3001
CMD ["node", "dist/main.js"]
