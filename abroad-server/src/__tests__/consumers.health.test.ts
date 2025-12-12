import 'reflect-metadata'

import type http from 'http'

import { createHealthHandler } from '../consumers'

type ResponseShape = {
  body: string
  headers: Record<string, string>
  statusCode: number
  end: (this: ResponseShape, chunk?: string) => ResponseShape
  setHeader: (this: ResponseShape, key: string, value: string) => ResponseShape
}

const buildResponse = () => {
  const response: ResponseShape = {
    body: '',
    headers: {},
    statusCode: 0,
    end(this: ResponseShape, chunk?: string) {
      if (chunk) {
        this.body += chunk
      }
      return this
    },
    setHeader(this: ResponseShape, key: string, value: string) {
      this.headers[key] = value
      return this
    },
  }

  return response as unknown as http.ServerResponse & { body: string, headers: Record<string, string>, statusCode: number }
}

describe('createHealthHandler', () => {
  it('reports readiness with 503 when consumers are not ready', () => {
    const handler = createHealthHandler({ live: true, ready: false })
    const res = buildResponse()
    handler({ url: '/readyz' } as unknown as http.IncomingMessage, res as http.ServerResponse)

    expect(res.statusCode).toBe(503)
    expect(res.headers?.['content-type']).toBe('text/plain')
    expect(res.body).toBe('not ready')
  })

  it('reports readiness with 200 when consumers are running', () => {
    const handler = createHealthHandler({ live: true, ready: true })
    const res = buildResponse()
    handler({ url: '/readyz' } as unknown as http.IncomingMessage, res as http.ServerResponse)

    expect(res.statusCode).toBe(200)
    expect(res.body).toBe('ready')
  })

  it('returns 404 for unknown endpoints', () => {
    const handler = createHealthHandler({ live: true, ready: true })
    const res = buildResponse()
    handler({ url: '/unknown' } as unknown as http.IncomingMessage, res as http.ServerResponse)

    expect(res.statusCode).toBe(404)
    expect(res.body).toBe('not found')
  })
})
