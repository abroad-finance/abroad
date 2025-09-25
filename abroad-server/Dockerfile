# syntax=docker/dockerfile:1.7

FROM oven/bun:1.2.22@sha256:66ba69deede44e3af5dc542def218fdb3bcad2205900ea761dc5623bf973d2df AS builder
WORKDIR /app

COPY package.json ./
COPY prisma ./prisma
RUN bun install

COPY . .
RUN bun run build
RUN cp src/swagger.json dist/swagger.json

FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma

CMD ["node","dist/server.js"]
