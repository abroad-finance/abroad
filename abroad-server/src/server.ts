// src/server.ts
import bodyParser from 'body-parser'
import cors from 'cors'
import dotenv from 'dotenv'
import express, { NextFunction, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import swaggerUi from 'swagger-ui-express'

import packageJson from '../package.json'
import { initAdmin } from './admin/admin'
import { RuntimeConfig } from './config/runtime'
import { ILogger } from './interfaces'
import { iocContainer } from './ioc'
import { RegisterRoutes } from './routes'
import { mapErrorToHttpResponse } from './shared/errors'
import { requestContextMiddleware } from './shared/requestContext'
import { TYPES } from './types'

dotenv.config()

const app = express()
const logger = iocContainer.get<ILogger>(TYPES.ILogger)
const health = { ready: false }
app.use(cors())
app.use(bodyParser.json())
// Handle text/json content-type generically (kept small)
app.use(bodyParser.json({ type: 'text/json' }))
app.use(requestContextMiddleware)

// Lightweight Movii webhook endpoint: log headers and payload, respond 200 with empty JSON (Movii sends Accept: application/json)
app.post('/webhooks/movii', (req: Request, res: Response) => {
  logger.info('Received Movii webhook', {
    body: req.body,
    headers: req.headers,
  })
  res.status(200).json({})
})

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
  function shutdown(signal: NodeJS.Signals) {
    health.ready = false
    logger.info(`${signal} received. Shutting down gracefully...`)
    // Stop accepting new connections
    server.close((err?: Error) => {
      if (err) {
        logger.error('Error during HTTP server close', err)
        process.exit(1)
      }
      logger.info('HTTP server closed. Bye!')
      process.exit(0)
    })

    // Fallback: force exit if it takes too long
    setTimeout(() => {
      logger.warn('Forcing shutdown after timeout')
      process.exit(1)
    }, RuntimeConfig.server.shutdownTimeoutMs).unref()
  }

  ;['SIGINT', 'SIGTERM'].forEach((sig) => {
    process.on(sig as NodeJS.Signals, shutdown)
  })
}

void start()
