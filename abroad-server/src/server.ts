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
import { RegisterRoutes } from './routes'

dotenv.config()

const app = express()
app.use(cors())
app.use(bodyParser.json())
// Allow larger payloads only for the Guardline webhook (avoid raising global limits)
app.use(
  '/webhook/guardline',
  bodyParser.json({ limit: '10mb', type: ['application/json', 'text/json', 'application/*+json'] }),
)
// Handle text/json content-type generically (kept small)
app.use(bodyParser.json({ type: 'text/json' }))

// -----------------------
// Serve AdminJS static CDN
// -----------------------
const adminAssetsDir = path.resolve(__dirname, '../public')
if (fs.existsSync(adminAssetsDir)) {
  app.use(
    '/admin-assets',
    express.static(adminAssetsDir, {
      immutable: process.env.NODE_ENV === 'production',
      maxAge: process.env.NODE_ENV === 'production' ? '1y' : 0,
    }),
  )
}

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
interface ApiError extends Error {
  status?: number
}

if (process.env.NODE_ENV === 'production') {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: ApiError, _req: Request, res: Response, _next: NextFunction) => {
    console.error('API error:', err)
    res.status(err.status ?? 500).json({
      message: err.message || 'An error occurred',
      reason: err.message || 'Internal Server Error',
    })
  })
}

// ---------------------
// Boot the HTTP server
// ---------------------
async function start() {
  // Mount AdminJS before starting the server
  try {
    await initAdmin(app)
  }
  catch (e) {
    console.warn('AdminJS failed to initialize:', e)
  }

  const port = process.env.PORT || 3784
  const server = app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`)
    console.log(`API docs at      http://localhost:${port}/docs`)
    console.log(`Admin panel at   http://localhost:${port}/admin`)
  })

  // ---------------------
  // Graceful shutdown
  // ---------------------
  function shutdown(signal: NodeJS.Signals) {
    console.log(`\n${signal} received. Shutting down gracefully...`)
    // Stop accepting new connections
    server.close((err?: Error) => {
      if (err) {
        console.error('Error during HTTP server close:', err)
        process.exit(1)
      }
      console.log('HTTP server closed. Bye!')
      process.exit(0)
    })

    // Fallback: force exit if it takes too long
    setTimeout(() => {
      console.warn('Forcing shutdown after timeout')
      process.exit(1)
    }, 10000).unref()
  }

  ;['SIGINT', 'SIGTERM'].forEach((sig) => {
    process.on(sig as NodeJS.Signals, shutdown)
  })
}

void start()
