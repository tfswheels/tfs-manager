# Multi-stage build for Node.js + Python support
FROM node:22-bullseye

# Install Python 3 and pip
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create symlink for python3 -> python
RUN ln -s /usr/bin/python3 /usr/bin/python

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
