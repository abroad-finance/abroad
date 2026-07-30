import { vi } from 'vitest'

import {
  buildPixCheckoutTelemetryContext,
  buildPixCheckoutTelemetryPayload,
  classifyPixCheckoutStatus,
  type PixCheckoutGate,
  type PixCheckoutGateSnapshot,
  recordPixCheckoutEvent,
  resolvePixCheckoutGate,
} from '../observability/pixCheckoutTelemetry'

const sendPixCheckoutTelemetryMock = vi.hoisted(() => vi.fn())

vi.mock('../services/public/publicApi', () => ({
  sendPixCheckoutTelemetry: sendPixCheckoutTelemetryMock,
}))

const readyGateSnapshot: PixCheckoutGateSnapshot = {
  authenticated: true,
  balanceLoading: false,
  hasAmounts: true,
  hasPixKey: true,
  hasQuote: true,
  hasTaxId: true,
  insufficientBalance: false,
  isAboveMaximum: false,
  isBelowMinimum: false,
  isMiniPay: false,
  isMiniPayReady: true,
  quoteLoading: false,
}

describe('PIX checkout telemetry', () => {
  it('normalizes route metadata to bounded values', () => {
    expect(buildPixCheckoutTelemetryContext({
      blockchain: 'stellar/customer-value',
      chainFamily: 'unknown-family',
      cryptoCurrency: 'USDC/customer-value',
      entryPoint: 'manual',
      walletSurface: 'web',
    })).toEqual({
      blockchain: 'OTHER',
      chainFamily: 'other',
      entryPoint: 'manual',
      sourceAsset: 'OTHER',
      walletSurface: 'web',
    })
  })

  it.each<{
    expected: PixCheckoutGate
    snapshot: Partial<PixCheckoutGateSnapshot>
  }>([
    {
      expected: 'wallet_not_authenticated',
      snapshot: { authenticated: false },
    },
    {
      expected: 'wallet_not_ready',
      snapshot: { isMiniPay: true, isMiniPayReady: false },
    },
    {
      expected: 'below_minimum',
      snapshot: { isBelowMinimum: true },
    },
    {
      expected: 'above_maximum',
      snapshot: { isAboveMaximum: true },
    },
    {
      expected: 'quote_pending',
      snapshot: { quoteLoading: true },
    },
    {
      expected: 'amount_missing',
      snapshot: { hasAmounts: false },
    },
    {
      expected: 'quote_unavailable',
      snapshot: { hasQuote: false },
    },
    {
      expected: 'balance_pending',
      snapshot: { balanceLoading: true },
    },
    {
      expected: 'insufficient_balance',
      snapshot: { insufficientBalance: true },
    },
    {
      expected: 'pix_key_missing',
      snapshot: { hasPixKey: false },
    },
    {
      expected: 'cpf_missing',
      snapshot: { hasTaxId: false },
    },
  ])('reports the $expected gate with deterministic precedence', ({ expected, snapshot }) => {
    expect(resolvePixCheckoutGate({
      ...readyGateSnapshot,
      ...snapshot,
    })).toBe(expected)
  })

  it('returns no gate when the PIX checkout is ready', () => {
    expect(resolvePixCheckoutGate(readyGateSnapshot)).toBeNull()
  })

  it('builds an allowlisted GCP telemetry payload with no free-form customer fields', () => {
    const payload = buildPixCheckoutTelemetryPayload({
      context: buildPixCheckoutTelemetryContext({
        blockchain: 'STELLAR',
        chainFamily: 'stellar',
        cryptoCurrency: 'USDC',
        entryPoint: 'qr',
        walletSurface: 'web',
      }),
      gate: 'cpf_missing',
      name: 'gate_blocked',
    })

    expect(payload).toEqual({
      blockchain: 'STELLAR',
      chainFamily: 'stellar',
      entryPoint: 'qr',
      eventName: 'gate_blocked',
      gate: 'cpf_missing',
      rail: 'PIX',
      schemaVersion: 1,
      sourceAsset: 'USDC',
      targetCurrency: 'BRL',
      walletSurface: 'web',
    })
    expect(Object.keys(payload)).not.toEqual(expect.arrayContaining([
      'account_number',
      'amount',
      'pix_key',
      'quote_id',
      'tax_id',
      'transaction_id',
      'user_id',
      'wallet_address',
    ]))
  })

  it('sends events through the Abroad API without blocking checkout', async () => {
    sendPixCheckoutTelemetryMock.mockRejectedValueOnce(new Error('GCP unavailable'))
    const event = {
      context: buildPixCheckoutTelemetryContext({
        blockchain: 'CELO',
        chainFamily: 'evm',
        cryptoCurrency: 'USDT',
        entryPoint: 'manual',
        walletSurface: 'web',
      }),
      name: 'submission_started',
    } as const

    expect(() => recordPixCheckoutEvent(event)).not.toThrow()
    await Promise.resolve()

    expect(sendPixCheckoutTelemetryMock).toHaveBeenCalledWith(
      buildPixCheckoutTelemetryPayload(event),
    )
  })

  it.each([
    { expected: 'network_error', status: null },
    { expected: 'client_error', status: 422 },
    { expected: 'server_error', status: 503 },
    { expected: 'unexpected', status: 302 },
  ] as const)('classifies $status as $expected', ({ expected, status }) => {
    expect(classifyPixCheckoutStatus(status)).toBe(expected)
  })
})
