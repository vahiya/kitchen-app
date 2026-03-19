FROM node:20-alpine AS builder
WORKDIR /build
COPY package*.json ./
RUN npm ci && npm cache clean --force
COPY . .

FROM node:20-alpine AS production
RUN addgroup -g 1001 -S nodejs && adduser -S nodeuser -u 1001 -G nodejs
WORKDIR /app
COPY --from=builder --chown=nodeuser:nodejs /build/node_modules ./node_modules
COPY --chown=nodeuser:nodejs server.js package.json ./
USER nodeuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "require('http').get('http://localhost:3000/health',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
