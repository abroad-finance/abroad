import axios from 'axios'
import { MainClient } from 'binance'

import { ExchangeConvertStepExecutor } from '../../../../../modules/flows/application/steps/ExchangeConvertStepExecutor'

jest.mock('axios', () => ({ get: jest.fn() }))
const submitNewOrderMock = jest.fn()
const getOrderMock = jest.fn()
const getAccountTradeListMock = jest.fn()
jest.mock('binance', () => ({
  MainClient: jest.fn().mockImplementation(() => ({
    getAccountTradeList: getAccountTradeListMock,
    getOrder: getOrderMock,
    submitNewOrder: submitNewOrderMock,
  })),
}))

const mockedAxios = axios as jest.Mocked<typeof axios>
const MockedMainClient = MainClient as unknown as jest.Mock

const USDCUSDT_INFO = {
  baseAsset: 'USDC',
  filters: [
    { filterType: 'LOT_SIZE', maxQty: '900000', minQty: '1.00000000', stepSize: '1.00000000' },
    { filterType: 'NOTIONAL', minNotional: '5.00000000' },
  ],
  quoteAsset: 'USDT',
  quoteAssetPrecision: 8,
  symbol: 'USDCUSDT',
}

const baseLogger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

const makeExecutor = () => {
  const secretManager = {
    getSecret: jest.fn(async (name: string) => {
      if (name.includes('URL')) return 'http://proxy.local'
      return `secret-${name}`
    }),
    getSecrets: jest.fn(async () => ({})),
  }
  const exchangeProviderFactory = {
    getExchangeProvider: jest.fn(),
    getExchangeProviderForCapability: jest.fn(),
  }
  const executor = new ExchangeConvertStepExecutor(
    exchangeProviderFactory as never,
    secretManager as never,
    baseLogger as never,
  )
  return { executor }
}

// exchangeInfo answers ONLY for the symbols passed in `valid`; everything else
// rejects with a Binance 400 (mirrors real "Invalid symbol" / code -1121).
const mockExchange = (valid: Record<string, typeof USDCUSDT_INFO>) => {
  mockedAxios.get.mockImplementation((async (url: string, opts?: { params?: { symbol?: string } }) => {
    const symbol = opts?.params?.symbol ?? ''
    if (url.includes('/exchangeInfo')) {
      if (valid[symbol]) return { data: { symbols: [valid[symbol]] } }
      const err = new Error('Request failed with status code 400') as Error & { response?: unknown }
      err.response = { data: { code: -1121, msg: 'Invalid symbol.' }, status: 400 }
      throw err
    }
    if (url.includes('/ticker/bookTicker')) {
      return { data: { askPrice: '1.00065000', bidPrice: '1.00064000', symbol } }
    }
    throw new Error(`unexpected axios call: ${url}`)
  }) as never)
}

describe('ExchangeConvertStepExecutor Binance market resolution', () => {
  beforeEach(() => {
    submitNewOrderMock.mockReset()
    submitNewOrderMock.mockResolvedValue({ cummulativeQuoteQty: '100.62', executedQty: '100.46', fills: [], orderId: 42 })
    getOrderMock.mockReset()
    getAccountTradeListMock.mockReset()
    mockedAxios.get.mockReset()
    MockedMainClient.mockClear()
  })

  // The pair lists as USDCUSDT (USDC base). To turn 100.62 USDT into USDC we must
  // BUY USDCUSDT, spending USDT via quoteOrderQty — NOT sell a non-existent USDTUSDC.
  it('resolves USDT->USDC to a BUY on USDCUSDT spending USDT (quoteOrderQty)', async () => {
    const { executor } = makeExecutor()
    mockExchange({ USDCUSDT: USDCUSDT_INFO })

    const result = await executor.execute({
      config: { fromAsset: 'USDT', provider: 'binance', toAsset: 'USDC' },
      runtime: { context: { sourceAmount: 100.62 } } as never,
      stepOrder: 5,
    })

    expect(result.outcome).toBe('succeeded')
    expect(submitNewOrderMock).toHaveBeenCalledTimes(1)
    expect(submitNewOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({ quoteOrderQty: 100.62, side: 'BUY', symbol: 'USDCUSDT', type: 'MARKET' }),
    )
  })

  // Reverse direction uses the same pair in its native orientation: SELL USDCUSDT.
  it('resolves USDC->USDT to a SELL on USDCUSDT (quantity in base asset)', async () => {
    const { executor } = makeExecutor()
    mockExchange({ USDCUSDT: USDCUSDT_INFO })

    const result = await executor.execute({
      config: { fromAsset: 'USDC', provider: 'binance', toAsset: 'USDT' },
      runtime: { context: { sourceAmount: 100.62 } } as never,
      stepOrder: 5,
    })

    expect(result.outcome).toBe('succeeded')
    expect(submitNewOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({ side: 'SELL', symbol: 'USDCUSDT', type: 'MARKET' }),
    )
    const payload = submitNewOrderMock.mock.calls[0][0]
    expect(payload.quantity).toBe(100) // floored to integer LOT_SIZE step
    expect(payload.quoteOrderQty).toBeUndefined()
  })

  it('honors an explicit symbol/side when the symbol is valid', async () => {
    const { executor } = makeExecutor()
    mockExchange({ USDCUSDT: USDCUSDT_INFO })

    const result = await executor.execute({
      config: { provider: 'binance', side: 'BUY', symbol: 'USDCUSDT' },
      runtime: { context: { sourceAmount: 100.62 } } as never,
      stepOrder: 5,
    })

    expect(result.outcome).toBe('succeeded')
    expect(submitNewOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({ side: 'BUY', symbol: 'USDCUSDT' }),
    )
  })

  // Never submit a doomed order for a pair that does not exist in either direction.
  it('fails without submitting an order when no Binance market exists for the pair', async () => {
    const { executor } = makeExecutor()
    mockExchange({ USDCUSDT: USDCUSDT_INFO }) // neither USDCBRL nor BRLUSDC is valid

    const result = await executor.execute({
      config: { fromAsset: 'USDC', provider: 'binance', toAsset: 'BRL' },
      runtime: { context: { sourceAmount: 100.62 } } as never,
      stepOrder: 5,
    })

    expect(result.outcome).toBe('failed')
    expect(submitNewOrderMock).not.toHaveBeenCalled()
  })

  // The realized RECEIVED amount (net of commission) must be output so the next
  // hop transfers/converts what was actually produced, not the quoted input.
  it('outputs the realized base amount received (net of commission) for a BUY', async () => {
    const { executor } = makeExecutor()
    mockExchange({ USDCUSDT: USDCUSDT_INFO })
    submitNewOrderMock.mockResolvedValue({
      cummulativeQuoteQty: '100.62',
      executedQty: '100.46',
      fills: [{ commission: '0.10', commissionAsset: 'USDC' }],
      orderId: 7,
    })

    const result = await executor.execute({
      config: { fromAsset: 'USDT', provider: 'binance', toAsset: 'USDC' },
      runtime: { context: { sourceAmount: 100.62 } } as never,
      stepOrder: 5,
    })

    expect(result.outcome).toBe('succeeded')
    expect(result.output?.amount).toBeCloseTo(100.36, 6) // 100.46 received USDC − 0.10 USDC commission
  })

  it('outputs the realized quote amount received (net of commission) for a SELL', async () => {
    const { executor } = makeExecutor()
    mockExchange({ USDCUSDT: USDCUSDT_INFO })
    submitNewOrderMock.mockResolvedValue({
      cummulativeQuoteQty: '100.06',
      executedQty: '100',
      fills: [{ commission: '0.05', commissionAsset: 'USDT' }],
      orderId: 8,
    })

    const result = await executor.execute({
      config: { fromAsset: 'USDC', provider: 'binance', toAsset: 'USDT' },
      runtime: { context: { sourceAmount: 100.62 } } as never,
      stepOrder: 5,
    })

    expect(result.outcome).toBe('succeeded')
    expect(result.output?.amount).toBeCloseTo(100.01, 6) // 100.06 received USDT − 0.05 USDT commission
  })

  // A transient exchangeInfo error (timeout/5xx) on a candidate must NOT be
  // mistaken for "symbol not listed": it fails terminally WITHOUT submitting an
  // order (no order placed ⇒ an explicit ops retry is the safe recovery, and
  // there is no un-resumable 'waiting' convert that strands forever).
  it('fails terminally without submitting an order on a transient exchangeInfo error', async () => {
    const { executor } = makeExecutor()
    mockedAxios.get.mockImplementation((async (url: string, opts?: { params?: { symbol?: string } }) => {
      const symbol = opts?.params?.symbol ?? ''
      if (url.includes('/exchangeInfo')) {
        if (symbol === 'USDCUSDT') {
          const err = new Error('Request failed with status code 503') as Error & { response?: { status: number } }
          err.response = { status: 503 }
          throw err
        }
        const notListed = new Error('Request failed with status code 400') as Error & { response?: unknown }
        notListed.response = { data: { code: -1121, msg: 'Invalid symbol.' }, status: 400 }
        throw notListed // USDTUSDC: genuinely not listed
      }
      throw new Error(`unexpected axios call: ${url}`)
    }) as never)

    const result = await executor.execute({
      config: { fromAsset: 'USDT', provider: 'binance', toAsset: 'USDC' },
      runtime: { context: { sourceAmount: 100.62 } } as never,
      stepOrder: 5,
    })

    expect(result.outcome).toBe('failed')
    expect(submitNewOrderMock).not.toHaveBeenCalled()
  })

  // Existence alone is not enough: a listed symbol whose base/quote do not match
  // the from/to intent must be rejected (guards against concatenation collisions).
  it('rejects a listed symbol whose base/quote do not match the intent', async () => {
    const { executor } = makeExecutor()
    // 'AAABBB' is listed but decomposes to base=AAAB/quote=BB, not AAA/BBB.
    mockExchange({ AAABBB: { ...USDCUSDT_INFO, baseAsset: 'AAAB', quoteAsset: 'BB', symbol: 'AAABBB' } })

    const result = await executor.execute({
      config: { fromAsset: 'AAA', provider: 'binance', toAsset: 'BBB' },
      runtime: { context: { sourceAmount: 100.62 } } as never,
      stepOrder: 5,
    })

    expect(result.outcome).toBe('failed')
    expect(submitNewOrderMock).not.toHaveBeenCalled()
  })

  // Idempotency: the order carries a deterministic clientOrderId derived from the
  // transaction + step so a retry maps to the SAME order on Binance.
  it('submits a deterministic clientOrderId derived from transactionId + step', async () => {
    const { executor } = makeExecutor()
    mockExchange({ USDCUSDT: USDCUSDT_INFO })

    await executor.execute({
      config: { fromAsset: 'USDT', provider: 'binance', toAsset: 'USDC' },
      runtime: { context: { sourceAmount: 100.62, transactionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } } as never,
      stepOrder: 5,
    })

    expect(submitNewOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({ newClientOrderId: 'aaaaaaaabbbbccccddddeeeeeeeeeeee5' }),
    )
  })

  // Idempotency: if the order already exists (Binance rejects the duplicate
  // clientOrderId on a retry), recover the existing fill — never re-submit.
  // NOTE: the `binance` client throws a PLAIN OBJECT { code, message, body },
  // NOT an axios-style Error with .response — the mock must match that contract.
  it('recovers the existing fill on a duplicate-order rejection instead of double-submitting', async () => {
    const { executor } = makeExecutor()
    mockExchange({ USDCUSDT: USDCUSDT_INFO })
    submitNewOrderMock.mockRejectedValue({ body: { code: -2010, msg: 'Duplicate order sent.' }, code: -2010, message: 'Duplicate order sent.' })
    getOrderMock.mockResolvedValue({ cummulativeQuoteQty: '100.62', executedQty: '100.46', orderId: 99, status: 'FILLED' })
    getAccountTradeListMock.mockResolvedValue([{ commission: '0.10', commissionAsset: 'USDC' }])

    const result = await executor.execute({
      config: { fromAsset: 'USDT', provider: 'binance', toAsset: 'USDC' },
      runtime: { context: { sourceAmount: 100.62, transactionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } } as never,
      stepOrder: 5,
    })

    expect(result.outcome).toBe('succeeded')
    expect(result.output?.amount).toBeCloseTo(100.36, 6) // recovered: 100.46 − 0.10 commission
    expect(submitNewOrderMock).toHaveBeenCalledTimes(1) // attempted once, NOT re-submitted
    expect(getOrderMock).toHaveBeenCalledWith(expect.objectContaining({ origClientOrderId: 'aaaaaaaabbbbccccddddeeeeeeeeeeee5', symbol: 'USDCUSDT' }))
  })

  // Money-safety on the recovery path: if the trade list (commission) can't be
  // read, do NOT return the gross (which would over-report and oversize the
  // withdraw) — fail so the operator retries once trades are queryable.
  it('does not recover (fails) when the recovered order trades cannot be read', async () => {
    const { executor } = makeExecutor()
    mockExchange({ USDCUSDT: USDCUSDT_INFO })
    submitNewOrderMock.mockRejectedValue({ body: { code: -2010, msg: 'Duplicate order sent.' }, code: -2010, message: 'Duplicate order sent.' })
    getOrderMock.mockResolvedValue({ cummulativeQuoteQty: '100.62', executedQty: '100.46', orderId: 99, status: 'FILLED' })
    getAccountTradeListMock.mockRejectedValue(new Error('trades unavailable'))

    const result = await executor.execute({
      config: { fromAsset: 'USDT', provider: 'binance', toAsset: 'USDC' },
      runtime: { context: { sourceAmount: 100.62, transactionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } } as never,
      stepOrder: 5,
    })

    expect(result.outcome).toBe('failed')
  })

  // A non-terminal PARTIALLY_FILLED order must not be snapshotted as the final
  // realized amount (would under-deliver) — surface as unresolved/retryable.
  it('does not recover (fails) when the existing order is only PARTIALLY_FILLED', async () => {
    const { executor } = makeExecutor()
    mockExchange({ USDCUSDT: USDCUSDT_INFO })
    submitNewOrderMock.mockRejectedValue({ body: { code: -2010, msg: 'Duplicate order sent.' }, code: -2010, message: 'Duplicate order sent.' })
    getOrderMock.mockResolvedValue({ cummulativeQuoteQty: '50.0', executedQty: '50.0', orderId: 99, status: 'PARTIALLY_FILLED' })

    const result = await executor.execute({
      config: { fromAsset: 'USDT', provider: 'binance', toAsset: 'USDC' },
      runtime: { context: { sourceAmount: 100.62, transactionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } } as never,
      stepOrder: 5,
    })

    expect(result.outcome).toBe('failed')
  })

  // The order executed but the realized amount can't be read ⇒ fail (operator-
  // retryable), never emit the wrong-denomination input amount downstream.
  it('fails when a filled order returns no executed quantity (never guesses the amount)', async () => {
    const { executor } = makeExecutor()
    mockExchange({ USDCUSDT: USDCUSDT_INFO })
    submitNewOrderMock.mockResolvedValue({ orderId: 7 }) // no executedQty/cummulativeQuoteQty

    const result = await executor.execute({
      config: { fromAsset: 'USDT', provider: 'binance', toAsset: 'USDC' },
      runtime: { context: { sourceAmount: 100.62 } } as never,
      stepOrder: 5,
    })

    expect(result.outcome).toBe('failed')
  })
})
