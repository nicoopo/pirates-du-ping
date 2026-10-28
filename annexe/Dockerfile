FROM node:24-alpine AS deps
WORKDIR /app/annexe
COPY annexe/package*.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app/annexe
COPY --from=deps /app/annexe/node_modules ./node_modules
COPY shared /app/shared
COPY annexe ./
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
