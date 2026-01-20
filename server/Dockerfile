# Multi-stage build for Node.js + Python support
# Using bookworm (Debian 12) for Python 3.11+ instead of bullseye (Debian 11 with Python 3.9)
FROM node:22-bookworm

# Install Python 3.11+, Chrome, and dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    build-essential \
    tesseract-ocr \
    chromium \
    chromium-driver \
    wget \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Create symlink for python3 -> python
RUN ln -s /usr/bin/python3 /usr/bin/python

# Set environment for Chrome/Chromium
ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMEDRIVER_PATH=/usr/bin/chromedriver

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --production

# Copy Python requirements
COPY workers/requirements.txt ./workers/

# Install Python dependencies
RUN pip3 install --no-cache-dir -r workers/requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 3000

# Start the server
CMD ["npm", "start"]
