FROM node:20-bookworm-slim

WORKDIR /app

# Copy package files & install Node dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy application source code
COPY . .

# Set environment & expose port
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Start attendance server
CMD ["node", "server/server.js"]
