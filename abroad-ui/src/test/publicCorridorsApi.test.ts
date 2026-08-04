import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import {
  afterAll,
  afterEach,
  beforeAll,
} from 'vitest'

import { fetchPublicCorridors } from '../services/public/publicApi'

const baseUrl = 'https://api.abroad.finance'
const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

// Mirrors the production /public/corridors payload: notify.endpoint is a
// root-relative path on notifying chains and null on Stellar.
const corridor = {
  blockchain: 'CELO',
  chainFamily: 'evm',
  chainId: 'eip155:42220',
  cryptoCurrency: 'USDC',
  maxAmount: null,
  minAmount: 0,
  notify: { endpoint: '/payments/notify', required: true },
  paymentMethod: 'PIX',
  targetCurrency: 'BRL',
  walletConnect: {
    chainId: 'eip155:42220',
    events: [],
    methods: ['personal_sign', 'eth_sendTransaction'],
    namespace: 'eip155',
  },
}

describe('public corridors API', () => {
  it('accepts a root-relative notify endpoint', async () => {
    server.use(http.get(`${baseUrl}/public/corridors`, () => (
      HttpResponse.json({ corridors: [corridor] })
    )))

    const response = await fetchPublicCorridors()

    expect(response.corridors).toHaveLength(1)
    expect(response.corridors[0].notify.endpoint).toBe('/payments/notify')
  })

  it('accepts a null notify endpoint', async () => {
    server.use(http.get(`${baseUrl}/public/corridors`, () => (
      HttpResponse.json({
        corridors: [{ ...corridor, notify: { endpoint: null, required: false } }],
      })
    )))

    const response = await fetchPublicCorridors()

    expect(response.corridors[0].notify.endpoint).toBeNull()
  })

  it('rejects a malformed corridor payload', async () => {
    server.use(http.get(`${baseUrl}/public/corridors`, () => (
      HttpResponse.json({ corridors: [{ ...corridor, targetCurrency: 'EUR' }] })
    )))

    await expect(fetchPublicCorridors()).rejects.toThrow('Invalid corridor configuration response')
  })
})
