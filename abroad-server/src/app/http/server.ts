// src/app/http/server.ts
import bodyParser from 'body-parser'
import cors from 'cors'
import dotenv from 'dotenv'
import express, { NextFunction, Request, Response } from 'express'
import fs from 'fs'
import geoip from 'geoip-lite'
import path from 'path'
import swaggerUi from 'swagger-ui-express'

import packageJson from '../../../package.json'
import { mapErrorToHttpResponse } from '../../core/errors'
import { ILogger } from '../../core/logging/types'
import { requestContextMiddleware } from '../../core/requestContext'
import { TransferoCallbackRegistrar } from '../../modules/treasury/infrastructure/exchangeProviders/TransferoCallbackRegistrar'
import { initSentry, setupSentryExpressErrorHandler } from '../../platform/observability/sentry'
import { ISecretManager } from '../../platform/secrets/ISecretManager'
import { initAdmin } from '../admin/admin'
import { RuntimeConfig } from '../config/runtime'
import { iocContainer } from '../container'
import { TYPES } from '../container/types'
import { RegisterRoutes } from './routes'

dotenv.config()
initSentry({ serviceName: 'abroad-api' })

const app = express()
const logger = iocContainer.get<ILogger>(TYPES.ILogger)
const health = { ready: false }
app.use(cors())
app.use(bodyParser.json())
// Handle text/json content-type generically (kept small)
app.use(bodyParser.json({ type: 'text/json' }))
app.use(requestContextMiddleware)

// ---------------------------
// tsoa‑generated application routes
// ---------------------------
RegisterRoutes(app)

// -------------------------------
// Swagger‑UI with route grouping
// -------------------------------
const swaggerPath = path.resolve(__dirname, './swagger.json')
const swaggerDocument = JSON.parse(fs.readFileSync(swaggerPath, 'utf8'))

/**
 * Add a tag to each operation whose `tags` array is empty or missing.
 * The tag is the first path segment (e.g. `/payments/send` → `payments`).
 */
function ensureTagsPerFirstSegment(doc: {
  paths: Record<string, Record<string, { tags: string[] }>>
  tags: { name: string }[]
}) {
  const knownTags = new Set<string>(
    (doc.tags ?? []).map((t: { name: string }) => t.name),
  )

  Object.entries(doc.paths).forEach(([route, methods]) => {
    const firstSegment = (route as string).split('/').filter(Boolean)[0] ?? 'root'

    // Add to top‑level tag list if it isn’t there yet
    if (!knownTags.has(firstSegment)) {
      knownTags.add(firstSegment)
      doc.tags = doc.tags ?? []
      doc.tags.push({ name: firstSegment })
    }

    Object.values(
      methods as Record<string, { tags: string[] }>,
    ).forEach((op) => {
      if (!op.tags || op.tags.length === 0) {
        op.tags = [firstSegment]
      }
    })
  })
}

ensureTagsPerFirstSegment(swaggerDocument)

app.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerDocument, {
    customSiteTitle: 'API documentation',
    explorer: true,
    swaggerOptions: {
      docExpansion: 'none',
      operationsSorter: 'alpha',
      tagsSorter: 'alpha',
    },
  }),
)

// Raw spec route
app.get('/swagger.json', (_req: Request, res: Response) => {
  res.sendFile(swaggerPath)
})

// -----------------
// Landing / health
// -----------------
app.get('/healthz', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' })
})

// Geo lookup used by the UI to gate access from blocked regions.
// Reads the client IP from X-Forwarded-For (the load balancer / Cloud Run
// frontend prepends the original client IP) and falls back to the socket
// address. Returns the resolved country and a `blocked` boolean; the UI is
// responsible for the redirect / 451 page. Fails open on lookup errors.
const BLOCKED_COUNTRIES = new Set<string>(['US'])
app.get('/geo/country', (req: Request, res: Response) => {
  const xff = req.header('x-forwarded-for')
  const ip = (xff?.split(',')[0]?.trim()) || req.socket.remoteAddress || ''
  const lookup = ip ? geoip.lookup(ip) : null
  const country = lookup?.country ?? null
  res.set('Cache-Control', 'private, no-store')
  res.status(200).json({
    blocked: country !== null && BLOCKED_COUNTRIES.has(country),
    country,
  })
})

app.get('/readyz', (_req: Request, res: Response) => {
  const status = health.ready ? 200 : 503
  res.status(status).json({ ready: health.ready })
})

app.get('/', (req: Request, res: Response) => {
  const base = `${req.protocol}://${req.get('host')}`
  res.format({
    'application/json': () =>
      res.json({
        documentation: `${base}/docs`,
        message: 'Welcome to the API',
        swagger: `${base}/swagger.json`,
        version: packageJson.version,
      }),
    'default': () => res.redirect('/docs'),
    'text/html': () => res.redirect('/docs'),
  })
})

// ---------------
// Error handling
// ---------------
// Sentry error handler must be registered after all routes, before other error middleware.
setupSentryExpressErrorHandler(app)

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('API error', err)
  const { body, status } = mapErrorToHttpResponse(err)
  res.status(status).json(body)
})

// ---------------------
// Boot the HTTP server
// ---------------------
async function start() {
  // Mount AdminJS before starting the server
  try {
    await initAdmin(app)
  }
  catch (e) {
    const error = e instanceof Error ? e : new Error(String(e))
    logger.warn('AdminJS failed to initialize', error)
    // Preserve legacy console warning for operational visibility and tests
    console.warn('AdminJS failed to initialize:', error)
  }

  // Ensure Transfero is subscribed to deposit/credit callbacks so incoming
  // deposits notify our webhook and AWAIT_EXCHANGE_BALANCE steps resume.
  // Idempotent and best-effort: it must never block service startup.
  try {
    const callbackRegistrar = new TransferoCallbackRegistrar(
      iocContainer.get<ISecretManager>(TYPES.ISecretManager),
      logger,
    )
    void callbackRegistrar.ensureSubscriptions()
  }
  catch (e) {
    logger.warn('Failed to start Transfero callback registration', e instanceof Error ? e : new Error(String(e)))
  }

  const port = RuntimeConfig.server.port
  const server = app.listen(port, () => {
    health.ready = true
    logger.info(`Server running on http://localhost:${port}`)
    logger.info(`API docs at      http://localhost:${port}/docs`)
    logger.info(`Admin panel at   http://localhost:${port}/admin`)
  })

  // ---------------------
  // Graceful shutdown
  // ---------------------
  let shutdownTimeout: NodeJS.Timeout | undefined
  let shuttingDown = false
  function shutdown(signal: NodeJS.Signals) {
    if (shuttingDown) {
      logger.warn(`${signal} received while shutdown already in progress`)
      return
    }

    shuttingDown = true
    health.ready = false
    logger.info(`${signal} received. Shutting down gracefully...`)
    shutdownTimeout = setTimeout(() => {
      logger.warn('Forcing shutdown after timeout')
      process.exit(1)
    }, RuntimeConfig.server.shutdownTimeoutMs).unref()

    // Stop accepting new connections
    server.close((err?: Error) => {
      if (shutdownTimeout) {
        clearTimeout(shutdownTimeout)
        shutdownTimeout = undefined
      }

      if (err) {
        logger.error('Error during HTTP server close', err)
        process.exit(1)
      }
      logger.info('HTTP server closed. Bye!')
      process.exit(0)
    })
  }

  ;['SIGINT', 'SIGTERM'].forEach((sig) => {
    process.on(sig as NodeJS.Signals, shutdown)
  })
}

void start()
