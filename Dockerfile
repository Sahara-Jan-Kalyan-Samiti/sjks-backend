# Build stage: install everything and compile TypeScript
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# Run stage: production dependencies and compiled code only
FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
# Cloud Run provides PORT (default 8080)
EXPOSE 8080
CMD ["node", "dist/server.js"]
