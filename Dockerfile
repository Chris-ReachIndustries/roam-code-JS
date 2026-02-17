FROM node:20-bookworm

# tree-sitter and better-sqlite3 need build tools
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json ./
RUN npm install --omit=optional --legacy-peer-deps

# Copy source code
COPY . .

# Make the CLI globally available in the container
RUN npm link

ENTRYPOINT ["node", "/app/bin/roam.js"]
