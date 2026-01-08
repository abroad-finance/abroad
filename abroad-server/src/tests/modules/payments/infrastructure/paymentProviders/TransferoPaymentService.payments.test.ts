import 'reflect-metadata'
import { TargetCurrency } from '@prisma/client'
import { type AxiosResponse } from 'axios'

import { buildTransferoHarness, mockedAxios, resetAxiosMocks } from './transferoPaymentService.fixtures'

afterEach(() => {
  jest.restoreAllMocks()
  resetAxiosMocks()
})

describe('TransferoPaymentService getLiquidity', () => {
  const stubToken = () => {
    const harness = buildTransferoHarness()
    jest.spyOn(harness.tokenAccessor, 'getAccessToken').mockResolvedValue('token-123')
    return harness
  }

  it('returns parsed liquidity and logs unexpected currency', async () => {
    const harness = stubToken()
    const balanceResponse = { balance: { amount: '1.234,56', currency: 'BRL' } }
    mockedAxios.get.mockResolvedValueOnce({ data: balanceResponse } as AxiosResponse<typeof balanceResponse>)

    const liquidity = await harness.service.getLiquidity()
    expect(liquidity).toBeCloseTo(1234.56)
    expect(harness.logger.warn).not.toHaveBeenCalled()

    const usdBalance = { balance: { amount: 500, currency: 'USD' } }
    mockedAxios.get.mockResolvedValueOnce({ data: usdBalance } as AxiosResponse<typeof usdBalance>)
    const mismatch = await harness.service.getLiquidity()

    expect(mismatch).toBe(0)
    expect(harness.logger.warn).toHaveBeenCalledWith(
      'Transfero getLiquidity unexpected payload',
      { balance: usdBalance.balance, expectedCurrency: TargetCurrency.BRL.toUpperCase() },
    )
  })

  it('logs and returns zero on upstream failures', async () => {
    mockedAxios.isAxiosError.mockReturnValue(false)
    mockedAxios.get.mockRejectedValueOnce(new Error('network down'))
    const harness = stubToken()

    const liquidity = await harness.service.getLiquidity()

    expect(liquidity).toBe(0)
    expect(harness.logger.error).toHaveBeenCalledWith('Transfero getLiquidity error:', 'network down')
  })

  it('stringifies axios error payloads on failures', async () => {
    mockedAxios.isAxiosError.mockReturnValueOnce(true)
    mockedAxios.get.mockRejectedValueOnce({ response: { data: { detail: 'bad' } } })
    const harness = stubToken()

    const liquidity = await harness.service.getLiquidity()

    expect(liquidity).toBe(0)
    expect(harness.logger.error).toHaveBeenCalledWith('Transfero getLiquidity error:', JSON.stringify({ detail: 'bad' }))
  })

  it('falls back to error message when axios payload is empty', async () => {
    mockedAxios.isAxiosError.mockReturnValueOnce(true)
    mockedAxios.get.mockRejectedValueOnce({ message: 'boom' })
    const harness = stubToken()

    const liquidity = await harness.service.getLiquidity()

    expect(liquidity).toBe(0)
    expect(harness.logger.error).toHaveBeenCalledWith('Transfero getLiquidity error:', JSON.stringify('boom'))
  })
})

describe('TransferoPaymentService buildContract', () => {
  it('decodes QR codes to build PIX contract entries', async () => {
    const harness = buildTransferoHarness()

    const contract = await harness.contractBuilder.buildContract({
      account: 'ignored',
      qrCode: 'qr-code',
      taxId: 'TAX-123',
      value: 50,
    })

    expect(contract).toEqual([{
      amount: 50,
      currency: 'BRL',
      name: 'QR Recipient',
      qrCode: 'qr-code',
      taxId: 'TAX-QR',
      taxIdCountry: 'BRA',
    }])
    expect(harness.pixDecoder.decode).toHaveBeenCalledWith('qr-code')
  })

  it('formats Brazilian phone numbers as PIX keys and accepts non-Brazilian inputs', async () => {
    const harness = buildTransferoHarness()

    const brazilian = await harness.contractBuilder.buildContract({
      account: '0 21 98765-4321',
      qrCode: null,
      taxId: 'TAX-ABC',
      value: 75,
    })
    expect(brazilian[0]).toMatchObject({ pixKey: '+5521987654321', taxId: 'TAX-ABC' })

    const foreign = await harness.contractBuilder.buildContract({
      account: 'user@example.com',
      qrCode: null,
      taxId: 'TAX-ABC',
      value: 75,
    })
    expect(foreign[0]).toMatchObject({ pixKey: 'user@example.com' })
  })

  it('accepts toll-free and carrier-prefixed domestic numbers while rejecting bad DDD codes', async () => {
    const harness = buildTransferoHarness()

    const tollFree = await harness.contractBuilder.buildContract({
      account: '0800 123 4567',
      qrCode: null,
      taxId: 'TAX-ABC',
      value: 10,
    })
    expect(tollFree[0]).toMatchObject({ pixKey: '+5508001234567' })

    const carrierPrefixed = await harness.contractBuilder.buildContract({
      account: '015 11 91234-5678',
      qrCode: null,
      taxId: 'TAX-ABC',
      value: 10,
    })
    expect(carrierPrefixed[0]).toMatchObject({ pixKey: '+5511912345678' })

    const invalidDdd = await harness.contractBuilder.buildContract({
      account: '001 23 456789',
      qrCode: null,
      taxId: 'TAX-ABC',
      value: 10,
    })
    expect(invalidDdd[0]).toMatchObject({ pixKey: '001 23 456789' })
  })
})

describe('TransferoPaymentService sendPayment', () => {
  const stubTransaction = () => {
    const harness = buildTransferoHarness()
    harness.prismaClient.transaction.findUnique.mockResolvedValue({ id: 'txn-1', taxId: 'TAX-USER' })
    jest.spyOn(harness.contractBuilder, 'buildContract').mockResolvedValue([
      { amount: 10, currency: 'BRL', name: 'Recipient', pixKey: '+5511999999999', taxId: 'TAX-USER', taxIdCountry: 'BRA' },
    ])
    jest.spyOn(harness.tokenAccessor, 'getAccessToken').mockResolvedValue('token-123')
    return harness
  }

  it('submits a payment group and returns the provider payment id', async () => {
    const harness = stubTransaction()
    mockedAxios.post.mockResolvedValueOnce({
      data: { payments: [{ paymentId: 'payment-123' }] },
    } as AxiosResponse<{ payments: Array<{ paymentId: string }> }>)

    const result = await harness.service.sendPayment({
      account: '11999999999',
      id: 'txn-1',
      qrCode: null,
      value: 10,
    })

    expect(result).toEqual({ success: true, transactionId: 'payment-123' })
    expect(harness.contractBuilder.buildContract).toHaveBeenCalledWith({
      account: '11999999999',
      qrCode: null,
      taxId: 'TAX-USER',
      value: 10,
    })
    expect(mockedAxios.post).toHaveBeenCalledTimes(1)
  })

  it('returns failure when the transaction lacks tax information', async () => {
    const harness = buildTransferoHarness()
    harness.prismaClient.transaction.findUnique.mockResolvedValue(null)

    const response = await harness.service.sendPayment({
      account: '11999999999',
      id: 'missing',
      qrCode: null,
      value: 10,
    })

    expect(response).toEqual({
      code: 'retriable',
      reason: 'Partner user not found or tax ID is missing.',
      success: false,
    })
    expect(harness.logger.error).toHaveBeenCalledWith(
      'Transfero sendPayment error:',
      'Partner user not found or tax ID is missing.',
    )
  })

  it('logs axios error payloads when submission fails', async () => {
    const harness = stubTransaction()
    mockedAxios.isAxiosError.mockReturnValue(true)
    mockedAxios.post.mockRejectedValueOnce({ response: { data: { reason: 'denied' } } })

    const result = await harness.service.sendPayment({
      account: '11999999999',
      id: 'txn-err',
      qrCode: null,
      value: 10,
    })

    expect(result).toEqual({ code: 'retriable', reason: JSON.stringify({ reason: 'denied' }), success: false })
    expect(harness.logger.error).toHaveBeenCalledWith(
      'Transfero sendPayment error:',
      JSON.stringify({ reason: 'denied' }),
    )
  })

  it('handles axios errors without response bodies', async () => {
    const harness = stubTransaction()
    mockedAxios.isAxiosError.mockReturnValue(true)
    mockedAxios.post.mockRejectedValueOnce({ message: 'plain axios' })

    const result = await harness.service.sendPayment({
      account: '123',
      id: 'txn-plain',
      qrCode: null,
      value: 5,
    })

    expect(result).toEqual({ code: 'retriable', reason: JSON.stringify('plain axios'), success: false })
    expect(harness.logger.error).toHaveBeenCalledWith('Transfero sendPayment error:', JSON.stringify('plain axios'))
  })
})
