# syntax=docker/dockerfile:1.7

FROM node:22-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build
RUN cp src/swagger.json dist/swagger.json

RUN npm prune --omit=dev
ENV NODE_ENV=production

CMD ["node","dist/server.js"]
