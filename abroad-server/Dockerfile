# syntax=docker/dockerfile:1.7

FROM oven/bun:1.2.22@sha256:66ba69deede44e3af5dc542def218fdb3bcad2205900ea761dc5623bf973d2df
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

ENV NODE_ENV=production

CMD ["bun","run","dist/server.js"]
