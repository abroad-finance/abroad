// src/server.ts
import bodyParser from 'body-parser'
import cors from 'cors'
import dotenv from 'dotenv'
import express, { Request, Response } from 'express'
import path from 'path'

import packageJson from '../package.json'
import { TransactionsController } from './controllers/queue/TransactionsController'
import { iocContainer } from './ioc'
import { RegisterRoutes } from './routes'
import { TYPES } from './types'

dotenv.config()
const app = express()
app.use(cors())
app.use(bodyParser.json())

RegisterRoutes(app)

app.get('/docs', (req: Request, res: Response) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>API Documentation</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/redoc@next/bundles/redoc.standalone.css">
      </head>
      <body>
        <redoc spec-url='/swagger.json'></redoc>
        <script src="https://cdn.jsdelivr.net/npm/redoc@next/bundles/redoc.standalone.js"></script>
      </body>
    </html>
  `)
})

app.get('/', (req: Request, res: Response) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`
  res.format({
    'application/json': () => {
      res.json({
        documentation: `${baseUrl}/docs`,
        message: 'Welcome to the API',
        swagger: `${baseUrl}/swagger.json`,
        version: packageJson.version,
      })
    },
    'default': () => {
      res.redirect('/docs')
    },
    'text/html': () => {
      res.redirect('/docs')
    },
  })
})

app.get('/swagger.json', (req: Request, res: Response) => {
  const swaggerPath = path.resolve(__dirname, './swagger.json')
  res.sendFile(swaggerPath)
})

// New Movii webhook endpoint
app.post('/movii-webhook', (req: Request, res: Response) => {
  console.log('Received Movii webhook:', JSON.stringify(req.body, null, 2))
  res.status(200).json({ message: 'Webhook received successfully' })
})

// if (process.env.NODE_ENV !== "development") {
//   app.use((err: any, req: Request, res: Response, next: any) => {
//     res.status(err.status || 500).json({
//       message: err.message || "An error occurred",
//     });
//   });
// }

const port = process.env.PORT || 3784
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`)
  console.log(`API documentation available at http://localhost:${port}/docs`)
})

const stellarTransactionsController
  = iocContainer.get<TransactionsController>(
    TYPES.TransactionsController,
  )
stellarTransactionsController.registerConsumers()
