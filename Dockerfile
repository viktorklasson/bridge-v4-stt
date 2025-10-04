# Use Node.js 18 on Ubuntu
FROM node:18-bullseye

# Install Xvfb and Chromium dependencies (use Debian's Chromium - faster)
RUN apt-get update && apt-get install -y \
    xvfb \
    chromium \
    chromium-sandbox \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (skip Puppeteer's Chromium download since we installed Chromium)
RUN PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true npm ci --only=production

# Copy application files
COPY . .

# Set environment variables
ENV DISPLAY=:99
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

# Expose port (Render provides PORT env var)
EXPOSE 3000

# Start Xvfb and the application
CMD Xvfb :99 -screen 0 1024x768x24 -nolisten tcp & npm start
