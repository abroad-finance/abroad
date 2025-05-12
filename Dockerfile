# syntax=docker/dockerfile:1.7

##########  BASE IMAGE  #######################################################
# “slim” is a little larger than Alpine but avoids native-addon recompiles,
# so npm ci is usually 2-3× faster.
FROM node:22.14.0-slim AS base
WORKDIR /app

##########  DEPENDENCY LAYER  (rarely changes)  ###############################
FROM base AS deps
COPY package-lock.json package.json ./

# Cache the npm directory – 100 % hit-rate when the lock-file is unchanged.
RUN --mount=type=cache,id=npm,target=/root/.npm \
    npm ci --ignore-scripts

##########  PRISMA LAYER  (changes when schema.prisma changes)  ###############
FROM deps AS prisma
COPY prisma/schema.prisma ./prisma/
# Generates node_modules/.prisma; re-runs ONLY when schema changes
RUN npx prisma generate

##########  BUILD LAYER  (changes when src/ changes)  #########################
FROM prisma AS build
# Copy build-time configs first (keeps cache hits high)
# - tsconfig*.json  – TypeScript compiler options
# - tsoa.json      – OpenAPI & route generation config
COPY tsconfig*.json tsoa.json ./
COPY src ./src
# Re-use the npm cache again while compiling
RUN --mount=type=cache,id=npm,target=/root/.npm \
    npm run build

##########  FINAL RUNTIME IMAGE  ##############################################
FROM base AS production
RUN apt-get update && \
    apt-get install -y chromium --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*
# Lightweight copy—only the artefacts required at runtime
ENV NODE_ENV=production
COPY --from=deps      /app/node_modules        ./node_modules
COPY --from=prisma    /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build     /app/dist                ./dist
COPY --from=build     /app/src/swagger.json     ./dist/swagger.json
COPY --from=build     /app/package.json        ./package.json
COPY prisma/schema.prisma ./prisma/schema.prisma

EXPOSE 3000
CMD ["node","dist/server.js"]
