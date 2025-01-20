# Step 1: Build the app
FROM node:23.6.0@sha256:d59184ad9bd55272f5847967574f2e259f8741239c4b5baf2395214b4d991296 AS build

# Create app directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Compile
RUN npm run build

# Step 2: Create a production image
FROM node:23.6.0@sha256:d59184ad9bd55272f5847967574f2e259f8741239c4b5baf2395214b4d991296

# Set working directory
WORKDIR /app

# Copy only the necessary files from the build stage
COPY --from=build /app/package*.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/swagger.json ./dist/swagger.json

# Install only production dependencies
RUN npm install --production

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["node", "dist/server.js"]
