FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY web/package*.json ./web/
RUN npm install --omit=dev --no-audit --no-fund \
 && npm --prefix web install --no-audit --no-fund

COPY . .
RUN npm --prefix web run build && rm -rf web/node_modules

EXPOSE 8080
CMD ["node", "server/index.js"]
