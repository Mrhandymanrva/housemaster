FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY web/package*.json ./web/
# NODE_ENV=production tells npm to drop devDependencies. The server wants that;
# web/ does not — vite is a devDependency and the build needs it.
RUN npm install --omit=dev --no-audit --no-fund \
 && npm --prefix web install --include=dev --no-audit --no-fund

COPY . .
RUN npm --prefix web run build && rm -rf web/node_modules

EXPOSE 8080
CMD ["node", "server/index.js"]
