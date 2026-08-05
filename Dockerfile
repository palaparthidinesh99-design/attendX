FROM node:20-bookworm-slim

# Install Python 3, pip, and required system libraries for OpenCV & DeepFace
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files & install Node dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy Python requirements & install Python dependencies for DeepFace & OpenCV
COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt --break-system-packages || pip3 install --no-cache-dir -r requirements.txt

# Copy application source code
COPY . .

# Set environment & expose port
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

# Start attendance server
CMD ["node", "server/server.js"]
