import 'reflect-metadata'

import { EtherfuseStablebondClient } from '../../../../../modules/treasury/infrastructure/stablebond/EtherfuseStablebondClient'
import { createMockLogger } from '../../../../setup/mockFactories'

// Shape and values taken from a real GET /lookup/bonds/cost/TESOURO response
// (2026-08-06). Every amount arrives as a decimal string.
const bondCost = {
  bond_cost_in_fiat: '1.238022',
  bond_cost_in_usd: '0.242721',
  bond_symbol: 'TESOURO',
  currency: 'BRL',
  current_basis_points: 1276,
  current_time: '2026-08-06T13:39:50.782085417+00:00',
  fiat_exchange_rate_with_usd: '5.10060',
  // Etherfuse adds per-source FX breakdowns over time; an unknown field must
  // not fail the parse.
  sources: { 'some-uuid': { bond_cost_in_usd: '0.242749', exchange_rate: '5.100009923' } },
}

const mockFetch = (body: unknown, ok = true, status = 200) => {
  global.fetch = jest.fn(async () => ({
    json: async () => body,
    ok,
    status,
  })) as unknown as typeof fetch
}

describe('EtherfuseStablebondClient', () => {
  const previousEnv = { ...process.env }
  const previousFetch = global.fetch

  afterEach(() => {
    process.env = { ...previousEnv }
    global.fetch = previousFetch
  })

  it('parses NAV and yield as exact decimals, not floats', async () => {
    mockFetch(bondCost)
    const client = new EtherfuseStablebondClient(createMockLogger())

    const valuation = await client.getValuation('TESOURO')

    expect(valuation.navFiat.toFixed()).toBe('1.238022')
    expect(valuation.navUsd.toFixed()).toBe('0.242721')
    expect(valuation.annualYieldBps).toBe(1276)
    expect(valuation.fiatCurrency).toBe('BRL')
    expect(valuation.symbol).toBe('TESOURO')
    expect(valuation.observedAt.toISOString()).toBe('2026-08-06T13:39:50.782Z')
  })

  it('calls the public lookup endpoint with no credential attached', async () => {
    mockFetch(bondCost)
    const client = new EtherfuseStablebondClient(createMockLogger())
    await client.getValuation('TESOURO')

    const [url, init] = jest.mocked(global.fetch).mock.calls[0]
    expect(url).toBe('https://api.etherfuse.com/lookup/bonds/cost/TESOURO')
    expect(init?.headers).toEqual({ accept: 'application/json' })
    expect(JSON.stringify(init)).not.toMatch(/authorization|api[_-]?key/i)
  })

  it('throws rather than returning a zero NAV when the response is unrecognised', async () => {
    mockFetch({ unexpected: true })
    const client = new EtherfuseStablebondClient(createMockLogger())

    await expect(client.getValuation('TESOURO')).rejects.toThrow(/did not match the expected shape/)
  })

  it('throws when the issuer quotes a non-positive NAV', async () => {
    mockFetch({ ...bondCost, bond_cost_in_fiat: '0' })
    const client = new EtherfuseStablebondClient(createMockLogger())

    await expect(client.getValuation('TESOURO')).rejects.toThrow(/non-positive NAV/)
  })

  it('throws on a non-2xx response', async () => {
    mockFetch({}, false, 503)
    const client = new EtherfuseStablebondClient(createMockLogger())

    await expect(client.getValuation('TESOURO')).rejects.toThrow('Etherfuse lookup responded 503')
  })

  it('rejects a non-https base URL override and keeps the default host', async () => {
    process.env.ETHERFUSE_API_BASE_URL = 'http://evil.test'
    mockFetch(bondCost)
    const logger = createMockLogger()

    await new EtherfuseStablebondClient(logger).getValuation('TESOURO')

    // The NAV sets the price at which real money is valued; a plaintext hop
    // would let it be rewritten in transit.
    expect(jest.mocked(global.fetch).mock.calls[0][0]).toBe('https://api.etherfuse.com/lookup/bonds/cost/TESOURO')
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('must be https'))
  })

  it('accepts an https base URL override', async () => {
    process.env.ETHERFUSE_API_BASE_URL = 'https://api.sand.etherfuse.com/'
    mockFetch(bondCost)

    await new EtherfuseStablebondClient(createMockLogger()).getValuation('TESOURO')

    expect(jest.mocked(global.fetch).mock.calls[0][0])
      .toBe('https://api.sand.etherfuse.com/lookup/bonds/cost/TESOURO')
  })

  it('escapes the symbol into the path', async () => {
    mockFetch(bondCost)
    await new EtherfuseStablebondClient(createMockLogger()).getValuation('../admin')

    expect(jest.mocked(global.fetch).mock.calls[0][0])
      .toBe('https://api.etherfuse.com/lookup/bonds/cost/..%2Fadmin')
  })
})
