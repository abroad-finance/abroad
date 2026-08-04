import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import {
  afterAll,
  afterEach,
  beforeAll,
} from 'vitest'

import {
  getKycStatus,
  submitKyc,
} from '../services/public/kycApi'

const baseUrl = 'https://api.abroad.finance'
const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('consumer KYC API', () => {
  it('submits the multipart request and validates the response status', async () => {
    server.use(http.post(`${baseUrl}/kyc`, () => (
      HttpResponse.json({ status: 'APPROVED' }, { status: 201 })
    )))

    const result = await submitKyc({
      address: 'Avenida Atlântica 100',
      city: 'Rio de Janeiro',
      dateOfBirth: '1990-01-01',
      document: new File(['pdf'], 'identity.pdf', { type: 'application/pdf' }),
      documentNumber: 'P123456',
      documentType: 'PASSPORT',
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      nationality: 'BR',
      phone: '+5521999999999',
      userId: 'stellar:pubnet:GOWNER',
    })

    if (!result.ok) {
      throw new Error(`${result.error.type}: ${result.error.message}`)
    }
    expect(result.data.status).toBe('APPROVED')
  })

  it('rejects malformed success payloads instead of widening unknown status values', async () => {
    server.use(
      http.get(`${baseUrl}/kyc/status`, () => HttpResponse.json({
        hasApproved: true,
        status: 'UNRECOGNIZED',
      })),
    )

    const result = await getKycStatus('stellar:pubnet:GOWNER')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.type).toBe('parse')
  })

  it('accepts every authoritative verification lifecycle status', async () => {
    server.use(
      http.get(`${baseUrl}/kyc/status`, () => HttpResponse.json({
        hasApproved: false,
        status: 'PENDING_APPROVAL',
      })),
    )

    const result = await getKycStatus('stellar:pubnet:GOWNER')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.status).toBe('PENDING_APPROVAL')
  })
})
