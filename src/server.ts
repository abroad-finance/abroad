// src/server.ts
import bodyParser from 'body-parser'
import cors from 'cors'
import dotenv from 'dotenv'
import express, { NextFunction, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import swaggerUi from 'swagger-ui-express'

import packageJson from '../package.json'
import { BinanceBalanceUpdatedController } from './controllers/queue/BinanceBalanceUpdatedController'
import { PaymentSentController } from './controllers/queue/PaymentSentController'
import { ReceivedCryptoTransactionController } from './controllers/queue/ReceivedCryptoTransactionController'
import { IAuthService } from './interfaces'
import { iocContainer } from './ioc'
import { RegisterRoutes } from './routes'
import { TYPES } from './types'

dotenv.config()

const app = express()
app.use(cors())
app.use(bodyParser.json())
// Handle text/json content-type for webhooks like Guardline
app.use(bodyParser.json({ type: 'text/json' }))

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

app.post('/webhook/guardline', (req: Request, res: Response) => {
  console.log('Guardline webhook endpoint hit')
  console.log('Guardline Request headers:', JSON.stringify(req.headers, null, 2))
  console.log('Guardline Request body:', JSON.stringify(req.body, null, 2))
  console.log('Guardline Raw body type:', typeof req.body)
  console.log('Guardline Body keys:', req.body ? Object.keys(req.body) : 'No body')

  res.status(200).send('Guardline webhook endpoint hit')
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
const port = process.env.PORT || 3784
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`)
  console.log(`API docs at      http://localhost:${port}/docs`)
})

// -------------------------------------------------
// Start queue consumers and initialise auth service
// -------------------------------------------------
iocContainer
  .get<ReceivedCryptoTransactionController>(
    TYPES.ReceivedCryptoTransactionController,
  )
  .registerConsumers()

iocContainer
  .get<PaymentSentController>(TYPES.PaymentSentController)
  .registerConsumers()

iocContainer
  .get<BinanceBalanceUpdatedController>(TYPES.BinanceBalanceUpdatedController)
  .registerConsumers()

iocContainer.get<IAuthService>(TYPES.IAuthService).initialize()
