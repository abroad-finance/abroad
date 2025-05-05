# Abroad Platform

This repository hosts the full-stack Abroad Platform, including a TypeScript-based Node.js API (using TSOA, Prisma, and Express) and a React + Vite frontend (in `abroad-ui`). It supports transactions, quotes, payments, and KYC flows.

## Prerequisites

- Docker & Docker Compose (for dev container)
- Node.js (>=18) and npm (pre-installed in dev container)
- Git (pre-installed in dev container)

## Development Setup

1. Clone the repository:
   ```bash
   git clone <repo-url> abroad
   cd abroad
   ```
2. Start the dev container (if using VS Code dev containers):
   - Open in VS Code and select "Reopen in Container".
3. Install dependencies:
   ```bash
   npm install      # installs backend deps
   cd abroad-ui
   npm install      # installs frontend deps
   cd ..
   ```
4. Configure environment variables:
   - Copy `.env.example` to `.env` (backend).
   - Copy `abroad-ui/.env.example` to `abroad-ui/.env` (frontend).
   - Update credentials (database URL, Firebase, secret manager, etc.).

## Running Locally

### Backend API

```bash
npm run dev:server   # starts TSOA+Express API with hot reload
``` 

### Frontend UI

```bash
cd abroad-ui
npm run dev          # starts Vite development server
``` 

### Combined

Run both servers concurrently or in separate terminals.

## Testing & Linting

- Run tests:
  ```bash
  npm test          # runs Jest for backend and frontend tests
  ```
- Lint code:
  ```bash
  npm run lint      # ESLint (skip lint errors when fixing code)
  ```

## Project Structure

```text
/abroad
├── src               # Backend source (TS, controllers, services, infrastructure)
├── prisma            # Database schema & migrations
├── tests             # Unit & integration tests
├── abroad-ui         # React + Vite frontend
├── cloud             # Cloud build & deployment configs
├── k8s               # Kubernetes manifests
├── Dockerfile        # Dockerfile for API
├── nodemon.json      # Dev server config
└── package.json      # Monorepo scripts & deps
```

## Deployment

- Build API Docker image:
  ```bash
  docker build -t abroad-api .
  ```
- Deploy with Kubernetes using manifests in `k8s/`.
- Cloud Build config in `cloud/cloudbuild.yaml`.

## Contributing

Contributions are welcome! Please open issues or PRs with clear descriptions.

## License

[MIT](LICENSE)