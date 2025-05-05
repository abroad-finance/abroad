# Dockerfile Optimized for Build Speed

# ---- Base Stage ----
# Use a specific Node.js Alpine version for consistency and smaller size.
# Using SHA ensures the base image doesn't change unexpectedly.
FROM node:22.14.0-alpine@sha256:9bef0ef1e268f60627da9ba7d7605e8831d5b56ad07487d24d1aa386336d1944 AS base
WORKDIR /app


# ---- Dependencies Stage ----
# This stage focuses only on installing dependencies.
# It leverages caching: this layer only rebuilds if package*.json changes.
FROM base AS dependencies
# Copy package.json and package-lock.json (or yarn.lock)
COPY package*.json ./
# Install all dependencies (including devDependencies needed for build)
# Using npm ci is generally faster and more reliable for CI/CD
RUN npm ci


# ---- Build Stage ----
# This stage builds the application using the installed dependencies.
FROM dependencies AS build
# Copy the rest of the application code
# This layer rebuilds whenever source code changes.
COPY . .
# Generate Prisma client - needs schema and dependencies
RUN npx prisma generate
# Compile the application
RUN npm run build


# ---- Production Stage ----
# This stage creates the final, lean production image.
FROM base AS production
# Set NODE_ENV to production
ENV NODE_ENV=production
# Copy necessary package files for production dependencies
COPY --from=dependencies /app/package*.json ./
# Install *only* production dependencies using npm ci --omit=dev
RUN npm ci --omit=dev
# Copy built application artifacts from the build stage
COPY --from=build /app/dist ./dist
# Copy Prisma schema needed at runtime
COPY --from=build /app/prisma ./prisma
# Copy other necessary static assets
COPY --from=build /app/src/swagger.json ./dist/swagger.json

# Expose the application port
EXPOSE 3000
# Define the command to run the application
CMD ["node", "dist/server.js"]
