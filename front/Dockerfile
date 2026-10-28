FROM node:24-alpine AS deps
WORKDIR /app/front
COPY front/package*.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app/front
COPY --from=deps /app/front/node_modules ./node_modules
COPY shared /app/shared
COPY front ./
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
