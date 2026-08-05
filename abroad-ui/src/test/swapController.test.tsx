import { act, renderHook } from '@testing-library/react'
import React from 'react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  vi,
} from 'vitest'

import type { IWallet } from '../interfaces/IWallet'
import type { WalletConnectRequest } from '../interfaces/IWallet'
import type { IWalletAuthentication } from '../interfaces/IWalletAuthentication'
import type { ApiResult } from '../services/http/types'
import type {
  AcceptTransactionRequest,
  AcceptTransactionResponse,
  PublicCorridorResponse,
} from '../services/public/types'

import { NoticeProvider } from '../contexts/NoticeContext'
import { WalletAuthContext } from '../contexts/WalletAuthContext'
import { PaymentAuthorizationError } from '../features/swap/services/paymentAuthorization'
import { useWebSwapController } from '../pages/WebSwap/useWebSwapController'
import { PENDING_TX_KEY } from '../shared/constants'

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

const createStablecoinBalanceState = (overrides?: Partial<{
  cUsd: string
  highestBalanceToken: 'cUSD' | 'USDC' | 'USDT'
  isLoading: boolean
  preferenceKind: 'empty' | 'supported' | 'unsupported-preferred'
  preferredSupportedToken: 'USDC' | 'USDT' | null
  usdc: string
  usdt: string
}>) => {
  const cUsd = overrides?.cUsd ?? '0.00'
  const usdc = overrides?.usdc ?? '25.00'
  const usdt = overrides?.usdt ?? '5.00'
  const preferredSupportedToken = overrides?.preferredSupportedToken ?? 'USDC'
  const highestBalanceToken = overrides?.highestBalanceToken ?? 'USDC'
  const preferenceKind = overrides?.preferenceKind ?? 'supported'

  return {
    balances: {
      cUSD: cUsd,
      USDC: usdc,
      USDT: usdt,
    },
    cUsd,
    error: null,
    isLoading: overrides?.isLoading ?? false,
    preference: {
      highestBalanceToken,
      kind: preferenceKind,
      preferredSupportedToken,
    },
    refresh: vi.fn(async () => undefined),
    supportedBalanceFor: (symbol: 'USDC' | 'USDT') => (symbol === 'USDT' ? usdt : usdc),
    usdc,
    usdt,
  }
}

const stablecoinBalancesMock = vi.hoisted(() => vi.fn(() => createStablecoinBalanceState()))
const pixCheckoutTelemetryMock = vi.hoisted(() => ({
  recordPixCheckoutEvent: vi.fn(),
}))
const paymentAuthorizationMock = vi.hoisted(() => vi.fn(async () => ({ onChainId: 'on-chain-id' })))
const kycApiMock = vi.hoisted(() => ({
  submitKyc: vi.fn(async () => ({
    data: { status: 'APPROVED' as const },
    headers: new Headers(),
    ok: true as const,
    status: 201,
  })),
}))

vi.mock('../observability/pixCheckoutTelemetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../observability/pixCheckoutTelemetry')>()
  return {
    ...actual,
    recordPixCheckoutEvent: pixCheckoutTelemetryMock.recordPixCheckoutEvent,
  }
})

vi.mock('../features/swap/services/paymentAuthorization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/swap/services/paymentAuthorization')>()
  return {
    ...actual,
    authorizeAcceptedPayment: paymentAuthorizationMock,
  }
})

vi.mock('../services/public/kycApi', () => ({
  submitKyc: kycApiMock.submitKyc,
}))

const createWalletRequestMock = (
  response: string = '0x-minipay-transaction',
): NonNullable<IWallet['request']> => {
  const requestMock = vi.fn(async (request: WalletConnectRequest): Promise<string> => {
    void request
    return response
  })

  // eslint-disable-next-line @stylistic/comma-dangle
  return async <TResult,>(request: WalletConnectRequest): Promise<TResult> => (
    await requestMock(request)
  ) as TResult
}

const mocked = vi.hoisted(() => {
  const abortResult = {
    error: {
      body: null,
      message: 'aborted',
      status: null,
      type: 'aborted',
    },
    headers: null,
    ok: false,
    status: null,
  } as const

  const requestQuoteMock = vi.fn((request: { amount: number }, opts?: { signal?: AbortSignal }) => new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({
        data: {
          expiration_time: Date.now() + 60_000,
          fee: { amount: '0.25', currency: 'USDC', type: 'combined' },
          quote_id: `q-${request.amount}`,
          value: request.amount * 2,
        },
        headers: new Headers(),
        ok: true,
        status: 200,
      })
    }, 50)
    opts?.signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve(abortResult)
    })
  }))

  const requestReverseQuoteMock = vi.fn(async () => ({
    data: {
      expiration_time: Date.now() + 60_000,
      fee: { amount: '0', currency: 'USDC', type: 'none' },
      quote_id: 'reverse-quote',
      value: 5,
    },
    headers: new Headers(),
    ok: true,
    status: 200,
  }))

  const decodeQrCodeBRMock = vi.fn(async () => ({
    data: { decoded: {} },
    headers: new Headers(),
    ok: true,
    status: 200,
  }))

  const acceptTransactionRequestMock = vi.fn(async (
    request: AcceptTransactionRequest,
  ): Promise<ApiResult<AcceptTransactionResponse>> => {
    void request
    return {
      data: {
        id: 'tx-1', kycRequired: false, payment_context: null, transaction_reference: 'ref',
      },
      headers: new Headers(),
      ok: true,
      status: 200,
    }
  })

  const fetchPublicCorridorsMock = vi.fn<[], Promise<PublicCorridorResponse>>(async () => ({
    corridors: [{
      blockchain: 'STELLAR',
      chainFamily: 'stellar',
      chainId: 'stellar:pubnet',
      cryptoCurrency: 'USDC',
      maxAmount: null,
      minAmount: null,
      notify: { endpoint: null, required: false },
      paymentMethod: 'PIX',
      targetCurrency: 'BRL',
      walletConnect: {
        chainId: 'stellar:pubnet',
        events: [],
        methods: ['stellar_signXDR'],
        namespace: 'stellar',
      },
    }, {
      blockchain: 'STELLAR',
      chainFamily: 'stellar',
      chainId: 'stellar:pubnet',
      cryptoCurrency: 'USDC',
      maxAmount: null,
      minAmount: null,
      notify: { endpoint: null, required: false },
      paymentMethod: 'BREB',
      targetCurrency: 'COP',
      walletConnect: {
        chainId: 'stellar:pubnet',
        events: [],
        methods: ['stellar_signXDR'],
        namespace: 'stellar',
      },
    }],
  }))

  return {
    abortResult,
    acceptTransactionRequestMock,
    decodeQrCodeBRMock,
    fetchPublicCorridorsMock,
    requestQuoteMock,
    requestReverseQuoteMock,
  }
})

vi.mock('../api', () => ({
  _36EnumsTargetCurrency: { BRL: 'BRL', COP: 'COP' },
  decodeQrCodeBR: mocked.decodeQrCodeBRMock,
}))

vi.mock('../services/public/publicApi', () => ({
  acceptTransactionRequest: mocked.acceptTransactionRequestMock,
  fetchPublicCorridors: mocked.fetchPublicCorridorsMock,
  notifyPayment: vi.fn(),
  requestQuote: mocked.requestQuoteMock,
  requestReverseQuote: mocked.requestReverseQuoteMock,
}))

vi.mock('../features/swap/hooks/useStablecoinBalances', () => ({
  useStablecoinBalances: stablecoinBalancesMock,
}))

const mockKit: IWallet = {
  address: 'GADDR',
  chainId: 'stellar:pubnet',
  connect: vi.fn(),
  disconnect: vi.fn(),
  signTransaction: vi.fn(async () => ({ signedTxXdr: 'signed-xdr', signerAddress: 'GADDR' })),
  walletId: 'stellar-kit',
}

const mockWalletAuthentication: IWalletAuthentication = {
  authenticate: vi.fn(),
  getAuthToken: vi.fn(),
  getChallengeMessage: vi.fn(),
  jwtToken: 'token',
  refreshAuthToken: vi.fn(),
  setJwtToken: vi.fn(),
}

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <NoticeProvider>
    <WalletAuthContext.Provider value={{
      defaultWallet: mockKit,
      getWalletHandler: vi.fn(() => mockKit),
      miniPay: {
        isActive: false,
        isReady: false,
        isResolving: false,
        status: 'inactive' as const,
      },
      setActiveWallet: vi.fn(),
      wallet: mockKit,
      walletAuthentication: mockWalletAuthentication,
    }}
    >
      {children}
    </WalletAuthContext.Provider>
  </NoticeProvider>
)

beforeEach(() => {
  vi.useFakeTimers()
  window.history.replaceState({}, '', '/')
  localStorage.clear()
  sessionStorage.clear()
  paymentAuthorizationMock.mockReset()
  paymentAuthorizationMock.mockResolvedValue({ onChainId: 'on-chain-id' })
  kycApiMock.submitKyc.mockReset()
  kycApiMock.submitKyc.mockResolvedValue({
    data: { status: 'APPROVED' },
    headers: new Headers(),
    ok: true,
    status: 201,
  })
  vi.mocked(mockKit.connect).mockReset()
  vi.mocked(mockKit.connect).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  stablecoinBalancesMock.mockReset()
  stablecoinBalancesMock.mockImplementation(() => createStablecoinBalanceState())
})

describe('useWebSwapController', () => {
  it('never restores a KYC screen without its intentionally non-persisted recipient data', async () => {
    sessionStorage.setItem(PENDING_TX_KEY, JSON.stringify({
      acceptedPayment: null,
      corridorKey: 'STELLAR:USDC:BRL:PIX',
      destination: { country: 'BR', currency: 'BRL', rail: 'PIX' },
      quote: {
        corridorKey: 'STELLAR:USDC:BRL:PIX',
        cryptoCurrency: 'USDC',
        expiresAt: Date.now() + 60_000,
        fee: null,
        id: 'quote-before-verification',
        network: 'STELLAR',
        rail: 'PIX',
        sourceAmount: 2.5,
        targetAmount: 5,
        targetCurrency: 'BRL',
      },
      schemaVersion: 4,
      sourceAmount: '2.5',
      targetAmount: '5',
      view: 'kyc-needed',
    }))

    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })
    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
      await Promise.resolve()
    })

    expect(result.current.view).not.toBe('kyc-needed')
    expect(result.current.kycCanResumePayment).toBe(false)
  })

  it('opens the PIX surface in the requested entry mode', async () => {
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })

    act(() => result.current.openQr('paste'))

    expect(result.current.isQrOpen).toBe(true)
    expect(result.current.qrEntryMode).toBe('paste')

    act(() => result.current.closeQr())
    expect(result.current.isQrOpen).toBe(false)

    act(() => result.current.openQr('camera'))
    expect(result.current.qrEntryMode).toBe('camera')

    act(() => result.current.openQr('upload'))
    expect(result.current.qrEntryMode).toBe('upload')
  })

  it('blames the provider, not the QR code, when the preview is rate limited', async () => {
    mocked.decodeQrCodeBRMock.mockResolvedValueOnce({
      data: { reason: 'The payment provider is busy. Retry in a moment.' },
      headers: new Headers(),
      ok: false,
      status: 429,
    } as never)
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })
    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })

    // Telling a customer to "check the code and try again" over a provider
    // throttle is what made them rescan into the same limit.
    await act(async () => {
      await expect(result.current.handleQrResult('00020101021226850014br.gov.bcb.pix'))
        .rejects.toMatchObject({
          code: 'rate-limited',
          message: expect.stringContaining('busy'),
        })
    })
  })

  it('surfaces wallet rejection as a recoverable bounded state', async () => {
    vi.mocked(mockKit.connect).mockRejectedValueOnce(
      Object.assign(new Error('User rejected wallet connection'), { code: 4001 }),
    )
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })
    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })

    act(() => result.current.requestConnectAfterSourceSelect())
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.walletConnectionInProgress).toBe(false)
    expect(result.current.walletConnectionIssue).toEqual({ code: 'rejected', retryable: true })
    act(() => result.current.clearWalletConnectionIssue())
    expect(result.current.walletConnectionIssue).toBeNull()
  })

  it('aborts stale quote requests', async () => {
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })

    act(() => {
      result.current.swapViewProps.onTargetChange('10')
      result.current.swapViewProps.onTargetChange('20')
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    expect(mocked.requestQuoteMock).toHaveBeenCalledTimes(2)
    expect(result.current.swapViewProps.sourceAmount).toBe('40')
    expect(result.current.swapViewProps.targetAmount).toBe('20')
  })

  it('retains the entered amount and exposes a safe retry when a quote times out', async () => {
    mocked.requestQuoteMock.mockImplementationOnce((_request, options) => new Promise((resolve) => {
      options?.signal?.addEventListener('abort', () => resolve(mocked.abortResult))
    }))
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })

    act(() => result.current.swapViewProps.onTargetChange('25'))
    await act(async () => vi.advanceTimersByTimeAsync(15_000))

    expect(result.current.swapViewProps.targetAmount).toBe('25')
    expect(result.current.swapViewProps.sourceAmount).toBe('')
    expect(result.current.swapViewProps.quoteIssue).toEqual({ action: 'retry', code: 'timeout' })
    expect(result.current.swapViewProps.continueDisabled).toBe(true)
  })

  it('auto-selects Stellar when SEP-24 token is present in URL', async () => {
    mocked.fetchPublicCorridorsMock.mockResolvedValueOnce({
      corridors: [{
        blockchain: 'BASE',
        chainFamily: 'evm',
        chainId: 'eip155:8453',
        cryptoCurrency: 'USDC',
        maxAmount: null,
        minAmount: null,
        notify: { endpoint: null, required: false },
        paymentMethod: 'PIX',
        targetCurrency: 'BRL',
        walletConnect: {
          chainId: 'eip155:8453',
          events: [],
          methods: ['eth_sendTransaction'],
          namespace: 'eip155',
        },
      }, {
        blockchain: 'STELLAR',
        chainFamily: 'stellar',
        chainId: 'stellar:pubnet',
        cryptoCurrency: 'USDC',
        maxAmount: null,
        minAmount: null,
        notify: { endpoint: null, required: false },
        paymentMethod: 'PIX',
        targetCurrency: 'BRL',
        walletConnect: {
          chainId: 'stellar:pubnet',
          events: [],
          methods: ['stellar_signXDR'],
          namespace: 'stellar',
        },
      }],
    })

    window.history.replaceState({}, '', '/?token=sep24-token&address=GADDR')

    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })

    expect(result.current.selectedChainKey).toContain('stellar')
  })

  it('does not advance confirm flow without amounts', async () => {
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })

    act(() => {
      result.current.confirmQrProps.onConfirm()
    })

    expect(result.current.view).toBe('swap')
  })

  it('quotes the effective rate without folding in the customer fee', async () => {
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })

    act(() => {
      result.current.swapViewProps.onTargetChange('5')
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    // The quote charges 10 USDC for 5 BRL and 0.25 of that is the customer
    // fee, so the rate is 5 / 9.75 rather than the 5 / 10 the charged amount
    // alone implies.
    expect(result.current.swapViewProps.exchangeRateDisplay).toBe('1 USDC = 0,51 BRL')
  })

  it('submits a valid BRL PIX quote through the transaction API after confirmation', async () => {
    mocked.acceptTransactionRequestMock.mockResolvedValueOnce({
      data: {
        id: null,
        kycRequired: true,
        payment_context: null,
        transaction_reference: null,
      },
      headers: new Headers(),
      ok: true,
      status: 200,
    })

    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })

    act(() => {
      result.current.swapViewProps.onTargetChange('5')
      result.current.swapViewProps.onRecipientChange?.('test-pix-key')
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    expect(mocked.requestQuoteMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        amount: 5,
        payment_method: 'PIX',
        target_currency: 'BRL',
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(result.current.swapViewProps.recipientValue).toBe('test-pix-key')
    expect('taxId' in result.current.swapViewProps).toBe(false)
    expect(result.current.swapViewProps.hasInsufficientFunds).toBe(false)
    expect(result.current.swapViewProps.feeDisplay).toBe('0.25 USDC · Combined fee')

    await act(async () => {
      await result.current.swapViewProps.onPrimaryAction()
    })

    expect(result.current.view).toBe('confirm-qr')
    expect(result.current.confirmQrProps.feeDisplay).toBe('0.25 USDC · Combined fee')

    await act(async () => {
      result.current.confirmQrProps.onConfirm()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocked.acceptTransactionRequestMock).toHaveBeenCalledTimes(1)
    expect(mocked.acceptTransactionRequestMock).toHaveBeenCalledWith(expect.objectContaining({
      account_number: 'test-pix-key',
      qr_code: null,
      quote_id: 'q-5',
    }))
    expect(mocked.acceptTransactionRequestMock.mock.calls[0]?.[0]).not.toHaveProperty('tax_id')
    expect(result.current.view).toBe('kyc-needed')
    expect(pixCheckoutTelemetryMock.recordPixCheckoutEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'quote_ready' }),
    )
    expect(pixCheckoutTelemetryMock.recordPixCheckoutEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'checkout_ready' }),
    )
    expect(pixCheckoutTelemetryMock.recordPixCheckoutEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'confirmation_viewed' }),
    )
    expect(pixCheckoutTelemetryMock.recordPixCheckoutEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'submission_started' }),
    )
    expect(pixCheckoutTelemetryMock.recordPixCheckoutEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'submission_accepted' }),
    )
    const telemetryJson = JSON.stringify(pixCheckoutTelemetryMock.recordPixCheckoutEvent.mock.calls)
    expect(telemetryJson).not.toContain('test-pix-key')
    expect(telemetryJson).not.toContain('tax_id')
    expect(telemetryJson).not.toContain('q-5')
    expect(telemetryJson).not.toContain('GADDR')
    expect(result.current.kycCanResumePayment).toBe(true)
  })

  it('returns a definitive recipient rejection to the retained form without technical HTTP copy', async () => {
    mocked.acceptTransactionRequestMock.mockResolvedValueOnce({
      error: {
        body: {
          code: 'invalid_recipient',
          reason: 'Provider-specific recipient detail',
        },
        message: 'Request failed with status 400',
        status: 400,
        type: 'http',
      },
      headers: null,
      ok: false,
      status: 400,
    })
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })
    act(() => {
      result.current.swapViewProps.onTargetChange('5')
      result.current.swapViewProps.onRecipientChange?.('recipient-before-correction')
    })
    await act(async () => vi.advanceTimersByTimeAsync(50))
    await act(async () => result.current.swapViewProps.onPrimaryAction())
    await act(async () => {
      result.current.confirmQrProps.onConfirm()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.view).toBe('swap')
    expect(result.current.swapViewProps.quoteIssue).toEqual({
      action: 'change-recipient',
      code: 'invalid-recipient',
    })
    expect(result.current.swapViewProps.continueDisabled).toBe(true)

    act(() => result.current.swapViewProps.onRecipientChange?.('corrected-recipient'))
    expect(result.current.swapViewProps.quoteIssue).toBeNull()
    expect(result.current.swapViewProps.recipientValue).toBe('corrected-recipient')
  })

  it('resumes a KYC-gated draft exactly once after authoritative approval', async () => {
    const transactionId = '11111111-1111-4111-8111-111111111111'
    mocked.acceptTransactionRequestMock
      .mockResolvedValueOnce({
        data: {
          id: null,
          kycRequired: true,
          payment_context: null,
          transaction_reference: null,
        },
        headers: new Headers(),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        data: {
          id: transactionId,
          kycRequired: false,
          payment_context: {
            amount: 2.5,
            blockchain: 'STELLAR',
            chainFamily: 'stellar',
            chainId: 'stellar:pubnet',
            cryptoCurrency: 'USDC',
            decimals: 7,
            depositAddress: 'GDEPOSIT',
            memo: 'payment-reference',
            memoType: 'text',
            mintAddress: 'GISSUER',
            notify: { endpoint: null, required: false },
            rpcUrl: 'https://horizon.example',
          },
          transaction_reference: 'payment-reference',
        },
        headers: new Headers(),
        ok: true,
        status: 200,
      })

    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })
    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })
    act(() => {
      result.current.swapViewProps.onTargetChange('5')
      result.current.swapViewProps.onRecipientChange?.('test-pix-key')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    await act(async () => {
      await result.current.swapViewProps.onPrimaryAction()
    })
    await act(async () => {
      result.current.confirmQrProps.onConfirm()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.view).toBe('kyc-needed')
    expect(result.current.kycCanResumePayment).toBe(true)

    await act(async () => {
      await result.current.handleKycSubmit({
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
      })
    })

    expect(kycApiMock.submitKyc).toHaveBeenCalledTimes(1)
    expect(mocked.acceptTransactionRequestMock).toHaveBeenCalledTimes(2)
    expect(paymentAuthorizationMock).toHaveBeenCalledTimes(1)
    expect(result.current.transactionId).toBe(transactionId)
    expect(result.current.view).toBe('txStatus')
  })

  it('persists the accepted Abroad ID and authorization context before calling the wallet', async () => {
    const transactionId = '11111111-1111-4111-8111-111111111111'
    mocked.acceptTransactionRequestMock.mockResolvedValueOnce({
      data: {
        id: transactionId,
        kycRequired: false,
        payment_context: {
          amount: 2.5,
          blockchain: 'STELLAR',
          chainFamily: 'stellar',
          chainId: 'stellar:pubnet',
          cryptoCurrency: 'USDC',
          decimals: 7,
          depositAddress: 'GDEPOSIT',
          memo: 'payment-reference',
          memoType: 'text',
          mintAddress: 'GISSUER',
          notify: { endpoint: null, required: false },
          rpcUrl: 'https://horizon.example',
        },
        transaction_reference: 'payment-reference',
      },
      headers: new Headers(),
      ok: true,
      status: 200,
    })
    paymentAuthorizationMock.mockImplementationOnce(async () => {
      const persisted = JSON.parse(sessionStorage.getItem('pendingTransaction') ?? '{}') as unknown
      expect(JSON.stringify(persisted)).toContain(transactionId)
      expect(JSON.stringify(persisted)).toContain('payment-reference')
      return { onChainId: 'confirmed-on-chain-id' }
    })

    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })
    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })
    act(() => {
      result.current.swapViewProps.onTargetChange('5')
      result.current.swapViewProps.onRecipientChange?.('test-pix-key')
    })
    await act(async () => vi.advanceTimersByTimeAsync(50))
    await act(async () => result.current.swapViewProps.onPrimaryAction())
    await act(async () => {
      result.current.confirmQrProps.onConfirm()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocked.acceptTransactionRequestMock).toHaveBeenCalledTimes(1)
    expect(paymentAuthorizationMock).toHaveBeenCalledTimes(1)
    expect(result.current.transactionId).toBe(transactionId)
    expect(result.current.authorizationState).toEqual({
      kind: 'broadcast-confirmed',
      onChainId: 'confirmed-on-chain-id',
      transactionId,
    })
    expect(result.current.view).toBe('txStatus')
  })

  it('resumes an explicitly rejected wallet authorization without accepting a second transaction', async () => {
    const transactionId = '22222222-2222-4222-8222-222222222222'
    mocked.acceptTransactionRequestMock.mockResolvedValueOnce({
      data: {
        id: transactionId,
        kycRequired: false,
        payment_context: {
          amount: 2.5,
          blockchain: 'STELLAR',
          chainFamily: 'stellar',
          chainId: 'stellar:pubnet',
          cryptoCurrency: 'USDC',
          decimals: 7,
          depositAddress: 'GDEPOSIT',
          memo: 'reference',
          memoType: 'text',
          mintAddress: 'GISSUER',
          notify: { endpoint: null, required: false },
          rpcUrl: 'https://horizon.example',
        },
        transaction_reference: 'reference',
      },
      headers: new Headers(),
      ok: true,
      status: 200,
    })
    paymentAuthorizationMock
      .mockRejectedValueOnce(new PaymentAuthorizationError('wallet-rejected', 'Wallet authorization was cancelled.'))
      .mockResolvedValueOnce({ onChainId: 'resumed-on-chain-id' })

    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })
    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })
    act(() => {
      result.current.swapViewProps.onTargetChange('5')
      result.current.swapViewProps.onRecipientChange?.('test-pix-key')
    })
    await act(async () => vi.advanceTimersByTimeAsync(50))
    await act(async () => result.current.swapViewProps.onPrimaryAction())
    await act(async () => {
      result.current.confirmQrProps.onConfirm()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.authorizationState).toEqual({ kind: 'wallet-rejected', transactionId })

    await act(async () => {
      await result.current.resumeAcceptedAuthorization()
    })

    expect(mocked.acceptTransactionRequestMock).toHaveBeenCalledTimes(1)
    expect(paymentAuthorizationMock).toHaveBeenCalledTimes(2)
    expect(result.current.authorizationState).toEqual({
      kind: 'broadcast-confirmed',
      onChainId: 'resumed-on-chain-id',
      transactionId,
    })
  })

  it('does not expose another wallet mutation after an ambiguous broadcast', async () => {
    const transactionId = '33333333-3333-4333-8333-333333333333'
    mocked.acceptTransactionRequestMock.mockResolvedValueOnce({
      data: {
        id: transactionId,
        kycRequired: false,
        payment_context: {
          amount: 2.5,
          blockchain: 'STELLAR',
          chainFamily: 'stellar',
          chainId: 'stellar:pubnet',
          cryptoCurrency: 'USDC',
          decimals: 7,
          depositAddress: 'GDEPOSIT',
          memo: 'reference',
          memoType: 'text',
          mintAddress: 'GISSUER',
          notify: { endpoint: null, required: false },
          rpcUrl: 'https://horizon.example',
        },
        transaction_reference: 'reference',
      },
      headers: new Headers(),
      ok: true,
      status: 200,
    })
    paymentAuthorizationMock.mockRejectedValueOnce(
      new PaymentAuthorizationError('broadcast-unknown', 'Transfer outcome is unknown.'),
    )

    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })
    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })
    act(() => {
      result.current.swapViewProps.onTargetChange('5')
      result.current.swapViewProps.onRecipientChange?.('test-pix-key')
    })
    await act(async () => vi.advanceTimersByTimeAsync(50))
    await act(async () => result.current.swapViewProps.onPrimaryAction())
    await act(async () => {
      result.current.confirmQrProps.onConfirm()
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.authorizationState).toEqual({ kind: 'broadcast-unknown', transactionId })

    await act(async () => {
      await result.current.resumeAcceptedAuthorization()
    })

    expect(mocked.acceptTransactionRequestMock).toHaveBeenCalledTimes(1)
    expect(paymentAuthorizationMock).toHaveBeenCalledTimes(1)
    expect(result.current.view).toBe('txStatus')
  })

  it('requires only the BRE-B key when using COP payouts', async () => {
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })

    act(() => result.current.selectCurrency('COP'))
    act(() => {
      result.current.swapViewProps.onTargetChange('5')
      result.current.swapViewProps.onRecipientChange?.('BREB-KEY-123456')
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    expect(mocked.requestQuoteMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        amount: 5,
        payment_method: 'BREB',
        target_currency: 'COP',
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(result.current.swapViewProps.recipientValue).toBe('BREB-KEY-123456')
    expect('taxId' in result.current.swapViewProps).toBe(false)
    expect(result.current.swapViewProps.continueDisabled).toBe(false)
  })

  it('keeps the current entry surface while switching target countries', async () => {
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })

    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })

    const onboardingRates = result.current.onboardingRates

    act(() => result.current.selectCurrency('COP'))
    expect(result.current.targetCurrency).toBe('COP')
    expect(result.current.view).toBe('home')
    expect(result.current.onboardingRates).toBe(onboardingRates)

    act(() => result.current.goToManual())
    expect(result.current.view).toBe('swap')

    act(() => result.current.selectCurrency('BRL'))
    expect(result.current.targetCurrency).toBe('BRL')
    expect(result.current.swapViewProps.targetCurrency).toBe('BRL')
    expect(result.current.view).toBe('swap')
    expect(result.current.onboardingRates).toBe(onboardingRates)

    act(() => result.current.selectCurrency('COP'))
    expect(result.current.targetCurrency).toBe('COP')
    expect(result.current.swapViewProps.targetCurrency).toBe('COP')
    expect(result.current.view).toBe('swap')
    expect(result.current.onboardingRates).toBe(onboardingRates)
  })

  it('requires confirmation before a destination change clears an active draft', async () => {
    const { result } = renderHook(() => useWebSwapController(), { wrapper: Wrapper })
    await act(async () => {
      await Promise.resolve()
      await mocked.fetchPublicCorridorsMock.mock.results[0]?.value
    })
    act(() => {
      result.current.goToManual()
      result.current.swapViewProps.onTargetChange('25')
      result.current.swapViewProps.onRecipientChange?.('synthetic-pix-key')
    })
    await act(async () => vi.advanceTimersByTimeAsync(50))

    act(() => result.current.selectCurrency('COP'))
    expect(result.current.targetCurrency).toBe('BRL')
    expect(result.current.pendingDestinationCurrency).toBe('COP')
    expect(result.current.swapViewProps.targetAmount).toBe('25')

    act(() => result.current.cancelDestinationChange())
    expect(result.current.pendingDestinationCurrency).toBeNull()
    expect(result.current.swapViewProps.targetAmount).toBe('25')

    act(() => result.current.selectCurrency('COP'))
    act(() => result.current.confirmDestinationChange())
    expect(result.current.targetCurrency).toBe('COP')
    expect(result.current.pendingDestinationCurrency).toBeNull()
    expect(result.current.swapViewProps.targetAmount).toBe('')
    expect(result.current.swapViewProps.recipientValue).toBe('')
  })

  it('locks MiniPay mode to Celo corridors and prefers the highest supported stablecoin', async () => {
    const miniPayWallet: IWallet = {
      address: '0x1111111111111111111111111111111111111111',
      chainId: 'eip155:42220',
      connect: vi.fn(),
      disconnect: vi.fn(),
      request: createWalletRequestMock(),
      signTransaction: vi.fn(async () => ({ signedTxXdr: 'unused', signerAddress: undefined })),
      walletId: 'mini-pay',
    }

    stablecoinBalancesMock.mockImplementation(() => createStablecoinBalanceState({
      cUsd: '40.00',
      highestBalanceToken: 'cUSD',
      preferenceKind: 'unsupported-preferred',
      preferredSupportedToken: 'USDT',
      usdc: '5.00',
      usdt: '22.00',
    }))

    mocked.fetchPublicCorridorsMock.mockResolvedValueOnce({
      corridors: [
        {
          blockchain: 'CELO',
          chainFamily: 'evm',
          chainId: 'eip155:42220',
          cryptoCurrency: 'USDC',
          maxAmount: null,
          minAmount: null,
          notify: { endpoint: '/payments/notify', required: true },
          paymentMethod: 'PIX',
          targetCurrency: 'BRL',
          walletConnect: {
            chainId: 'eip155:42220',
            events: [],
            methods: ['eth_sendTransaction'],
            namespace: 'eip155',
          },
        },
        {
          blockchain: 'CELO',
          chainFamily: 'evm',
          chainId: 'eip155:42220',
          cryptoCurrency: 'USDT',
          maxAmount: null,
          minAmount: null,
          notify: { endpoint: '/payments/notify', required: true },
          paymentMethod: 'PIX',
          targetCurrency: 'BRL',
          walletConnect: {
            chainId: 'eip155:42220',
            events: [],
            methods: ['eth_sendTransaction'],
            namespace: 'eip155',
          },
        },
        {
          blockchain: 'STELLAR',
          chainFamily: 'stellar',
          chainId: 'stellar:pubnet',
          cryptoCurrency: 'USDC',
          maxAmount: null,
          minAmount: null,
          notify: { endpoint: null, required: false },
          paymentMethod: 'PIX',
          targetCurrency: 'BRL',
          walletConnect: {
            chainId: 'stellar:pubnet',
            events: [],
            methods: ['stellar_signXDR'],
            namespace: 'stellar',
          },
        },
      ],
    })

    const MiniPayWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <NoticeProvider>
        <WalletAuthContext.Provider value={{
          defaultWallet: miniPayWallet,
          getWalletHandler: vi.fn(() => miniPayWallet),
          miniPay: {
            isActive: true,
            isReady: true,
            isResolving: false,
            status: 'ready',
          },
          setActiveWallet: vi.fn(),
          wallet: miniPayWallet,
          walletAuthentication: {
            ...mockWalletAuthentication,
            jwtToken: null,
          },
        }}
        >
          {children}
        </WalletAuthContext.Provider>
      </NoticeProvider>
    )

    const { result } = renderHook(() => useWebSwapController(), { wrapper: MiniPayWrapper })

    await act(async () => {
      await Promise.resolve()
      const latestCall = mocked.fetchPublicCorridorsMock.mock.results[mocked.fetchPublicCorridorsMock.mock.results.length - 1]
      await latestCall?.value
    })

    expect(result.current.isMiniPay).toBe(true)
    expect(result.current.chainOptions).toHaveLength(1)
    expect(result.current.swapViewProps.selectedAssetLabel).toBe('USDT')
    expect(result.current.swapViewProps.miniPayNotice?.title).toBe('Use USDC or USDT')
  })
})
