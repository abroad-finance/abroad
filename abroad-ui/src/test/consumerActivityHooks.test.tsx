import { act, renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type { ConsumerActivityTransactionDto } from '../api'
import type { IWallet } from '../interfaces/IWallet'
import type { IWalletAuthentication } from '../interfaces/IWalletAuthentication'

import { WalletAuthContext } from '../contexts/WalletAuthContext'
import {
  useConsumerActivityDetail,
  useConsumerActivityList,
  useConsumerActivityReceiptDownload,
} from '../features/activity/hooks/useConsumerActivity'

const mocked = vi.hoisted(() => ({
  getConsumerActivity: vi.fn(),
  getConsumerActivityReceipt: vi.fn(),
  listConsumerActivity: vi.fn(),
}))

vi.mock('../api', () => ({
  getConsumerActivity: mocked.getConsumerActivity,
  getConsumerActivityReceipt: mocked.getConsumerActivityReceipt,
  listConsumerActivity: mocked.listConsumerActivity,
}))

vi.mock('../contexts/WebSocketContext', () => ({
  useWebSocketSubscription: () => undefined,
}))

const wallet: IWallet = {
  address: 'GABC',
  chainId: 'stellar:pubnet',
  connect: vi.fn(),
  disconnect: vi.fn(),
  signTransaction: vi.fn(async () => ({ signedTxXdr: 'xdr', signerAddress: 'GABC' })),
  walletId: 'stellar-kit',
}

const walletAuthentication: IWalletAuthentication = {
  authenticate: vi.fn(),
  getAuthToken: vi.fn(),
  getChallengeMessage: vi.fn(),
  jwtToken: 'wallet-token',
  refreshAuthToken: vi.fn(),
  setJwtToken: vi.fn(),
}

const activity = {
  id: '11111111-1111-4111-8111-111111111111',
  proof: { receiptAvailable: false, status: 'PENDING' },
  quote: {
    country: 'BR',
    network: 'STELLAR',
    paymentMethod: 'PIX',
    sourceAmount: 10,
    sourceCurrency: 'USDC',
    targetAmount: 52.54,
    targetCurrency: 'BRL',
  },
  recipientHint: '•••• 1234',
  refund: { reference: null, status: 'NOT_APPLICABLE' },
  status: 'PROCESSING_PAYMENT',
  timestamps: {
    acceptedAt: '2026-08-01T10:00:00.000Z',
    completedAt: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    lastReconciledAt: null,
    payoutSubmittedAt: null,
    updatedAt: '2026-08-01T10:02:00.000Z',
  },
} satisfies ConsumerActivityTransactionDto

const buildWrapper = (authenticated = true): React.FC<{ children: React.ReactNode }> => {
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <WalletAuthContext.Provider value={{
      miniPay: {
        isActive: false,
        isReady: false,
        isResolving: false,
        status: 'inactive',
      },
      wallet: authenticated ? wallet : undefined,
      walletAuthentication: authenticated ? walletAuthentication : undefined,
    }}
    >
      {children}
    </WalletAuthContext.Provider>
  )
  return Wrapper
}

beforeEach(() => {
  mocked.getConsumerActivity.mockReset()
  mocked.getConsumerActivityReceipt.mockReset()
  mocked.listConsumerActivity.mockReset()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:activity-receipt'),
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
})

describe('useConsumerActivityList', () => {
  it('does not query until a wallet bearer session exists', () => {
    const { result } = renderHook(
      () => useConsumerActivityList({ page: 1, pageSize: 20 }),
      { wrapper: buildWrapper(false) },
    )

    expect(result.current.status).toBe('unauthenticated')
    expect(mocked.listConsumerActivity).not.toHaveBeenCalled()
  })

  it('loads one server-filtered page and reports authoritative counts', async () => {
    mocked.listConsumerActivity.mockResolvedValue({
      data: {
        items: [activity], page: 2, pageSize: 10, total: 31,
      },
      headers: new Headers(),
      ok: true,
      status: 200,
    })

    const { result } = renderHook(
      () => useConsumerActivityList({
        page: 2, pageSize: 10, paymentMethod: 'PIX', sort: 'oldest',
      }),
      { wrapper: buildWrapper() },
    )

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(mocked.listConsumerActivity).toHaveBeenCalledWith(
      {
        page: 2, pageSize: 10, paymentMethod: 'PIX', sort: 'oldest',
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(result.current.items).toEqual([activity])
    expect(result.current.page).toBe(2)
    expect(result.current.total).toBe(31)
  })

  it('restores and deduplicates every loaded server page in accumulated mode', async () => {
    const secondActivity = {
      ...activity,
      id: '22222222-2222-4222-8222-222222222222',
    }
    mocked.listConsumerActivity
      .mockResolvedValueOnce({
        data: {
          items: [activity], page: 1, pageSize: 50, total: 2,
        },
        headers: new Headers(),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        data: {
          items: [secondActivity], page: 2, pageSize: 50, total: 2,
        },
        headers: new Headers(),
        ok: true,
        status: 200,
      })

    const { result } = renderHook(
      () => useConsumerActivityList({ page: 2, pageSize: 50 }, { accumulatePages: true }),
      { wrapper: buildWrapper() },
    )

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(mocked.listConsumerActivity).toHaveBeenNthCalledWith(
      1,
      { page: 1, pageSize: 50 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(mocked.listConsumerActivity).toHaveBeenNthCalledWith(
      2,
      { page: 2, pageSize: 50 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(result.current.items.map(item => item.id)).toEqual([activity.id, secondActivity.id])
    expect(result.current.total).toBe(2)
  })

  it('retains the last good page when a manual refresh fails', async () => {
    mocked.listConsumerActivity
      .mockResolvedValueOnce({
        data: {
          items: [activity], page: 1, pageSize: 20, total: 1,
        },
        headers: new Headers(),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        data: { reason: 'Temporarily unavailable' },
        headers: new Headers(),
        ok: false,
        status: 400,
      })

    const { result } = renderHook(
      () => useConsumerActivityList({ page: 1, pageSize: 20 }),
      { wrapper: buildWrapper() },
    )

    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => result.current.refresh())

    expect(result.current.status).toBe('stale')
    expect(result.current.items).toEqual([activity])
    expect(result.current.error).toBe('Temporarily unavailable')
  })

  it('rejects malformed success payloads behind a stable client error', async () => {
    mocked.listConsumerActivity.mockResolvedValue({
      data: {
        items: [{ ...activity, status: 'PROVIDER_COMPLETE' }],
        page: 1,
        pageSize: 20,
        total: 1,
      },
      headers: new Headers(),
      ok: true,
      status: 200,
    })

    const { result } = renderHook(
      () => useConsumerActivityList({ page: 1, pageSize: 20 }),
      { wrapper: buildWrapper() },
    )

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe('Unable to load Activity right now.')
    expect(result.current.items).toEqual([])
  })
})

describe('useConsumerActivityDetail', () => {
  it('keeps missing and malformed details as explicit errors', async () => {
    mocked.getConsumerActivity.mockResolvedValue({
      data: { reason: 'Activity transaction not found' },
      headers: new Headers(),
      ok: false,
      status: 404,
    })

    const { result } = renderHook(
      () => useConsumerActivityDetail('11111111-1111-4111-8111-111111111111'),
      { wrapper: buildWrapper() },
    )

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe('Activity transaction not found')
    expect(result.current.receipt).toBeNull()
  })

  it('does not render a malformed receipt as authoritative Activity', async () => {
    mocked.getConsumerActivity.mockResolvedValue({
      data: { ...activity, status: 'PROVIDER_COMPLETE' },
      headers: new Headers(),
      ok: true,
      status: 200,
    })

    const { result } = renderHook(
      () => useConsumerActivityDetail(activity.id),
      { wrapper: buildWrapper() },
    )

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe('Unable to load this Activity item.')
    expect(result.current.receipt).toBeNull()
  })
})

describe('useConsumerActivityReceiptDownload', () => {
  it('downloads an owned bounded PDF through the generated consumer endpoint', async () => {
    mocked.getConsumerActivityReceipt.mockResolvedValue({
      data: {
        contentBase64: 'JVBERi0=',
        contentType: 'application/pdf',
        fileName: 'abroad-receipt.pdf',
        sizeBytes: 5,
      },
      headers: new Headers(),
      ok: true,
      status: 200,
    })
    const { result } = renderHook(
      () => useConsumerActivityReceiptDownload(activity.id),
      { wrapper: buildWrapper() },
    )

    let downloaded = false
    await act(async () => {
      downloaded = await result.current.download('en')
    })

    expect(downloaded).toBe(true)
    expect(mocked.getConsumerActivityReceipt).toHaveBeenCalledWith(activity.id, { lang: 'en' })
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    expect(result.current.error).toBeNull()
  })

  it('rejects malformed proof bytes and exposes an actionable error', async () => {
    mocked.getConsumerActivityReceipt.mockResolvedValue({
      data: {
        contentBase64: 'bm90LWEta25vd24tcGRm',
        contentType: 'application/pdf',
        fileName: 'receipt.pdf',
        sizeBytes: 15,
      },
      headers: new Headers(),
      ok: true,
      status: 200,
    })
    const { result } = renderHook(
      () => useConsumerActivityReceiptDownload(activity.id),
      { wrapper: buildWrapper() },
    )

    await act(async () => {
      expect(await result.current.download('pt-BR')).toBe(false)
    })

    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(result.current.error).toBe('The receipt file is invalid.')
  })
})
