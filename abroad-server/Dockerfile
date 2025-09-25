# syntax=docker/dockerfile:1.7

FROM oven/bun:1.2.22@sha256:66ba69deede44e3af5dc542def218fdb3bcad2205900ea761dc5623bf973d2df AS builder
WORKDIR /app

# Copy the monorepo manifests up front so Docker layer caching stays effective
COPY package.json bun.lock ./
COPY abroad-server/package.json abroad-server/package.json

WORKDIR /app/abroad-server
COPY abroad-server/prisma ./prisma
RUN bun install --frozen-lockfile

COPY abroad-server/ ./
RUN bun run build
RUN cp src/swagger.json dist/swagger.json

FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/abroad-server/node_modules ./node_modules
COPY --from=builder /app/abroad-server/dist ./dist
COPY --from=builder /app/abroad-server/package.json ./package.json
COPY --from=builder /app/abroad-server/prisma ./prisma

CMD ["node","dist/server.js"]
