# syntax=docker/dockerfile:1.6

# ---- builder stage: install deps, run build pipeline + Vite build ----
FROM node:20-alpine AS builder
WORKDIR /app

# Install workspace dependencies first (cache-friendly)
COPY package.json package-lock.json* ./
COPY build/package.json build/package.json
COPY site/package.json site/package.json
RUN npm install --no-audit --no-fund

# Copy sources
COPY build ./build
COPY site ./site

# Build TypeScript pipeline + run it to populate site/public/{builds.json,icons,data}
RUN npm run build:data
# Build the static site
RUN npm run build:site

# ---- serve stage: nginx serving the static site ----
FROM nginx:alpine AS serve
COPY --from=builder /app/site/dist /usr/share/nginx/html
# SPA fallback: serve index.html for any unmatched route
RUN printf 'server {\n\
  listen 80;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
