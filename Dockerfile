# ─────────────────────────────────────────────
#  Stage 1: Build the NestJS API
# ─────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
COPY tsconfig.json ./
COPY nest-cli.json ./
RUN npm ci

# Copy source and build
COPY src/ ./src/
COPY scripts/ ./scripts/
RUN npm run build

# ─────────────────────────────────────────────
#  Stage 2: Dashboard build
# ─────────────────────────────────────────────
FROM node:22-slim AS dashboard-builder

WORKDIR /app/dashboard
COPY dashboard/package*.json ./
RUN npm ci
COPY dashboard/ ./
RUN npm run build

# ─────────────────────────────────────────────
#  Stage 3: Runtime — Python + Node + Camoufox
# ─────────────────────────────────────────────
FROM node:22-slim

# Install Python, system deps for Firefox and Xvfb (for virtual display mode)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    xvfb \
    libgtk-3-0 libdbus-glib-1-2 libxt6 libasound2 \
    libnss3 libxss1 libatk1.0-0 libatk-bridge2.0-0 \
    libgbm1 libxkbcommon0 libpango-1.0-0 libcairo2 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Create a Python virtual environment and install Camoufox
RUN python3 -m venv /opt/camoufox-venv
ENV PATH="/opt/camoufox-venv/bin:$PATH"
RUN pip install --no-cache-dir -U pip && \
    pip install --no-cache-dir "camoufox[geoip]"

WORKDIR /app

# Copy built application
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/scripts ./scripts
COPY --from=dashboard-builder /app/dashboard/dist ./dashboard/dist

# Create data directory for persistent profiles
RUN mkdir -p /app/data/profiles

# Download Camoufox browser binary at build time
RUN python -m camoufox fetch || echo "Camoufox fetch failed — run manually"

ENV NODE_ENV=production
ENV CAMOUFOX_USER_DATA_DIR=/app/data/profiles
EXPOSE 3000

CMD ["node", "dist/main.js"]
