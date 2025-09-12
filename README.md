# Abroad Platform

This repository hosts the full-stack Abroad Platform as a simple monorepo with:
- `abroad-server`: TypeScript Node.js API (TSOA, Prisma, Express)
- `abroad-ui`: React + Vite frontend

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
   cd abroad-server && npm install
   cd ../abroad-ui && npm install
   cd ..
   ```
4. Configure environment variables:
   - Copy `.env.example` to `.env` (backend).
   - Copy `abroad-ui/.env.example` to `abroad-ui/.env` (frontend).
   - Update credentials (database URL, Firebase, secret manager, etc.).

## Running Locally

### Backend API

```bash
npm run dev:server          # from repo root, or:
cd abroad-server && npm run dev
```

### Frontend UI

```bash
npm run dev:ui              # from repo root, or:
cd abroad-ui && npm run dev
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
.
├── abroad-server
│   ├── src               # API source (controllers, services, infra)
│   ├── prisma            # Prisma schema & migrations
│   ├── k8s               # Kubernetes manifests
│   ├── cloud             # Cloud Build config
│   ├── Dockerfile        # API Dockerfile
│   ├── package.json      # Server scripts & deps
│   └── ...               # Server configs (tsoa, tsconfig, jest, etc.)
├── abroad-ui             # React + Vite frontend
│   └── package.json
└── package.json          # Monorepo helper scripts
```

## Deployment

- Build API Docker image (from repo root):
  ```bash
  docker build -t abroad-api -f abroad-server/Dockerfile abroad-server
  ```
- Kubernetes manifests now live under `abroad-server/k8s/`.
- Cloud Build config moved to `abroad-server/cloud/cloudbuild.yaml` and uses the new Dockerfile path.

## Contributing

Contributions are welcome! Please open issues or PRs with clear descriptions.

## License

[MIT](LICENSE)
