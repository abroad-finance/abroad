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

## Observability (Sentry)

Sentry is optional in both `abroad-server` and `abroad-ui`.

- Backend (`abroad-server`) runtime env vars:
  - `SENTRY_DSN`
  - `SENTRY_ENVIRONMENT` (defaults to `NODE_ENV`)
  - `SENTRY_RELEASE` (optional)
- Frontend (`abroad-ui`) runtime env vars:
  - `VITE_SENTRY_DSN`
  - `VITE_SENTRY_ENVIRONMENT` (defaults to `import.meta.env.MODE`)
  - `VITE_SENTRY_RELEASE` (optional)
- Frontend sourcemap upload during build (CI only):
  - `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`
  - `SENTRY_RELEASE` (or a CI commit SHA env var such as `GITHUB_SHA`)
  - Ensure `VITE_SENTRY_RELEASE` matches the release name used for upload, otherwise Sentry cannot apply sourcemaps.

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

### Frontend (Vercel) – deploy automático desde GitHub

El frontend (`abroad-ui`) está configurado para desplegarse en [Vercel](https://vercel.com). El archivo `vercel.json` en la raíz del repo define:

- **Build:** `npm run build:ui` (monorepo root)
- **Output:** `abroad-ui/dist`

Para que **cada push a GitHub dispare un deploy automático**:

1. Entra a [Vercel Dashboard](https://vercel.com) e inicia sesión con la cuenta del equipo (ej. abroad@kinto.info).
2. Abre el proyecto **abroad** (o créalo si aún no está vinculado a Git).
3. Ve a **Settings → Git**.
4. En **Connect Git Repository** elige **GitHub** y autoriza a Vercel si lo pide.
5. Conecta el repo **abroad-kinto/abroad** (o el que uses).
6. En **Production Branch** pon la rama que quieras para producción, por ejemplo `new-ui` o `main`.
7. Guarda. A partir de ahí, cada push (y cada PR) generará un deploy:
   - **Rama de producción** → actualiza la URL de producción (ej. `abroad-delta.vercel.app`).
   - **Otras ramas y PRs** → generan una preview con URL única.

Las variables de entorno (Vite, Sentry, etc.) se configuran en **Settings → Environment Variables** del proyecto en Vercel. Para que el front en Vercel hable con tu API y WebSocket:

- **`VITE_API_URL`**: URL base del API (ej. `https://api.abroad.finance`). Sin esto, las peticiones REST y la URL del WebSocket pueden fallar o apuntar al dominio de la preview.
- **`VITE_WS_URL`** (opcional): URL del WebSocket (ej. `wss://api.abroad.finance:4000`). Si no se define, se deriva de `VITE_API_URL` + puerto `4000`. El servidor debe exponer ese puerto y aceptar conexiones desde el dominio del front (CORS/WS).

Si en la consola ves errores de conexión a `wss://api.abroad.finance:4000`, comprueba que el backend esté levantado, que el puerto 4000 sea accesible desde internet y que en Vercel tengas `VITE_API_URL` (y si hace falta `VITE_WS_URL`) configuradas.

### API / Backend

- Build API Docker image (from repo root):
  ```bash
  docker build -t abroad-api -f abroad-server/Dockerfile abroad-server
  ```
- Kubernetes manifests now live under `abroad-server/k8s/`.
- GKE workloads deployed via kustomize now include listeners, consumers, and the outbox worker health service.
- Cloud Build config moved to `abroad-server/cloud/cloudbuild.yaml` and uses the new Dockerfile path.

## Contributing

Contributions are welcome! Please open issues or PRs with clear descriptions.

## License

[MIT](LICENSE)
