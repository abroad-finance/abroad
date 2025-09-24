# syntax=docker/dockerfile:1.7

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY . .
RUN npm install --omit=dev
RUN npm run build 
RUN cp src/swagger.json dist/swagger.json

CMD ["node","dist/server.js"]
