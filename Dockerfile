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
RUN npm install --force && npm rebuild

# Copy source code
COPY . .

# Make the CLI globally available in the container
RUN npm link

# Fix rollup native module (npm bug with optional platform-specific deps)
RUN ROLLUP_V=$(node -p "require('./node_modules/rollup/package.json').version") \
    && curl -sL "https://registry.npmjs.org/@rollup/rollup-linux-x64-gnu/-/rollup-linux-x64-gnu-${ROLLUP_V}.tgz" \
       | tar xz -C /tmp \
    && cp /tmp/package/rollup.linux-x64-gnu.node node_modules/rollup/dist/ \
    && rm -rf /tmp/package

ENTRYPOINT ["node", "/app/bin/roam.js"]
