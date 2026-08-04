# Multi-stage production Dockerfile
FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy source files
COPY server/ ./server/
COPY public/ ./public/

# Set security headers & non-root user
USER node

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "server/server.js"]
