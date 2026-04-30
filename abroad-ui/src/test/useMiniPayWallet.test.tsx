/**
 * Tests for useMiniPayWallet hook
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import {
  describe, expect, it, vi,
} from 'vitest'

import { useMiniPayWallet } from '../services/wallets/useMiniPayWallet'

// Mock the minipay module - must be hoisted
const mockResolveMiniPayAddress = vi.fn()
const mockReadMiniPaySessionAddress = vi.fn()
const mockWriteMiniPaySessionAddress = vi.fn()
const mockGetMiniPayBrowserRuntime = vi.fn()
const mockGetMiniPayProvider = vi.fn()
const mockSanitizeMiniPayRequest = vi.fn(req => req)

vi.mock('../services/wallets/minipay', () => ({
  getMiniPayBrowserRuntime: () => mockGetMiniPayBrowserRuntime(),
  getMiniPayProvider: () => mockGetMiniPayProvider(),
  MINIPAY_CHAIN_ID: 'eip155:42220',
  readMiniPaySessionAddress: () => mockReadMiniPaySessionAddress(),
  resolveMiniPayAddress: (...args: unknown[]) => mockResolveMiniPayAddress(...args),
  sanitizeMiniPayRequest: (req: unknown) => mockSanitizeMiniPayRequest(req),
  writeMiniPaySessionAddress: (...args: unknown[]) => mockWriteMiniPaySessionAddress(...args),
}))

describe('useMiniPayWallet', () => {
  const mockBrowserRuntime = {
    provider: {
      request: vi.fn(),
    },
    sessionStore: {} as Storage,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should start with inactive state when MiniPay runtime is not available', () => {
      mockGetMiniPayBrowserRuntime.mockReturnValue(null)

      const { result } = renderHook(() => useMiniPayWallet())

      expect(result.current.runtime.isActive).toBe(false)
      expect(result.current.runtime.isReady).toBe(false)
      expect(result.current.runtime.isResolving).toBe(false)
      expect(result.current.runtime.status).toBe('inactive')
      expect(result.current.wallet.address).toBe(null)
      expect(result.current.wallet.chainId).toBe(null)
      expect(result.current.wallet.walletId).toBe(null)
    })

    it('should start with available state when MiniPay runtime is available but no cached address', async () => {
      mockGetMiniPayBrowserRuntime.mockReturnValue(mockBrowserRuntime)
      mockReadMiniPaySessionAddress.mockReturnValue(null)
      mockResolveMiniPayAddress.mockResolvedValue({
        address: null,
        chainId: 'eip155:42220',
      })

      const { result } = renderHook(() => useMiniPayWallet())

      // Wait for initial resolveAddress call to complete
      await waitFor(() => {
        expect(result.current.runtime.status).toBe('available')
      })

      expect(result.current.runtime.isActive).toBe(true)
      expect(result.current.runtime.isReady).toBe(false)
      expect(result.current.runtime.status).toBe('available')
      expect(result.current.wallet.address).toBe(null)
      expect(result.current.wallet.chainId).toBe('eip155:42220')
      expect(result.current.wallet.walletId).toBe('mini-pay')
    })

    it('should start with ready state when cached address exists', async () => {
      mockGetMiniPayBrowserRuntime.mockReturnValue(mockBrowserRuntime)
      mockReadMiniPaySessionAddress.mockReturnValue('0xCachedAddress')
      mockResolveMiniPayAddress.mockResolvedValue({
        address: '0xResolvedAddress',
        chainId: 'eip155:42220',
      })

      const { result } = renderHook(() => useMiniPayWallet())

      // Wait for initial resolveAddress to complete (hook auto-resolves on mount)
      await waitFor(() => {
        expect(result.current.runtime.isReady).toBe(true)
      })

      // Should be ready with cached address (or resolved address)
      expect(result.current.runtime.isActive).toBe(true)
      expect(result.current.runtime.isReady).toBe(true)
      expect(result.current.runtime.isResolving).toBe(false)
      expect(result.current.runtime.status).toBe('ready')
      // Address should be either cached or resolved
      expect(result.current.wallet.address).toMatch(/^0x/)
      expect(result.current.wallet.chainId).toBe('eip155:42220')
    })
  })

  describe('wallet connection', () => {
    it('should resolve address when connect is called', async () => {
      mockGetMiniPayBrowserRuntime.mockReturnValue(mockBrowserRuntime)
      mockReadMiniPaySessionAddress.mockReturnValue(null)
      // First call returns null (initial mount), second call returns address (connect)
      mockResolveMiniPayAddress
        .mockResolvedValueOnce({
          address: null,
          chainId: 'eip155:42220',
        })
        .mockResolvedValueOnce({
          address: '0xResolvedAddress',
          chainId: 'eip155:42220',
        })

      const { result } = renderHook(() => useMiniPayWallet())

      // Wait for initial resolve to complete (returns null, stays in 'available')
      await waitFor(() => {
        expect(result.current.runtime.status).toBe('available')
      })

      // Connect - this triggers resolveAddress again
      await act(async () => {
        await result.current.wallet.connect()
      })

      await waitFor(() => {
        expect(result.current.wallet.address).toBe('0xResolvedAddress')
      })
      expect(result.current.runtime.isReady).toBe(true)
    })

    it('should handle resolution error and use cached address', async () => {
      mockGetMiniPayBrowserRuntime.mockReturnValue(mockBrowserRuntime)
      mockReadMiniPaySessionAddress.mockReturnValue('0xCachedAddress')
      mockResolveMiniPayAddress.mockRejectedValue(new Error('Resolution failed'))

      const { result } = renderHook(() => useMiniPayWallet())

      // Wait for resolution to complete and fall back to cached address
      await waitFor(() => {
        expect(result.current.runtime.isReady).toBe(true)
        expect(result.current.wallet.address).toBe('0xCachedAddress')
      })
    })

    it('should handle resolution error with no cached address', async () => {
      mockGetMiniPayBrowserRuntime.mockReturnValue(mockBrowserRuntime)
      mockReadMiniPaySessionAddress.mockReturnValue(null)
      mockResolveMiniPayAddress.mockRejectedValue(new Error('Resolution failed'))

      const { result } = renderHook(() => useMiniPayWallet())

      await waitFor(() => {
        expect(result.current.wallet.address).toBe(null)
        expect(result.current.runtime.isReady).toBe(false)
      })
    })
  })

  describe('wallet disconnection', () => {
    it('should clear session and reset state', async () => {
      mockGetMiniPayBrowserRuntime.mockReturnValue(mockBrowserRuntime)
      mockReadMiniPaySessionAddress.mockReturnValue('0xCachedAddress')
      mockResolveMiniPayAddress.mockResolvedValue({
        address: '0xResolvedAddress',
        chainId: 'eip155:42220',
      })

      const { result } = renderHook(() => useMiniPayWallet())

      // Wait for initial state
      await waitFor(() => {
        expect(result.current.wallet.address).toBe('0xResolvedAddress')
      })

      // Disconnect
      await act(async () => {
        await result.current.wallet.disconnect()
      })

      expect(mockWriteMiniPaySessionAddress).toHaveBeenCalledWith(mockBrowserRuntime.sessionStore, null)
      expect(result.current.wallet.address).toBe(null)
      expect(result.current.runtime.isReady).toBe(false)
    })
  })

  describe('transaction signing', () => {
    it('should throw error since MiniPay uses eth_sendTransaction only', async () => {
      mockGetMiniPayBrowserRuntime.mockReturnValue(mockBrowserRuntime)

      const { result } = renderHook(() => useMiniPayWallet())

      await expect(
        result.current.wallet.signTransaction({ message: '0xTx' }),
      ).rejects.toThrow('MiniPay signs transactions through eth_sendTransaction only')
    })
  })

  describe('request method', () => {
    it('should forward request to MiniPay provider', async () => {
      mockGetMiniPayBrowserRuntime.mockReturnValue(mockBrowserRuntime)
      mockGetMiniPayProvider.mockReturnValue(mockBrowserRuntime.provider)
      mockBrowserRuntime.provider.request.mockResolvedValue('0xResult')
      mockReadMiniPaySessionAddress.mockReturnValue(null)
      mockResolveMiniPayAddress.mockResolvedValue({
        address: '0xAddress',
        chainId: 'eip155:42220',
      })

      const { result } = renderHook(() => useMiniPayWallet())

      // Wait for wallet to be ready
      await waitFor(() => {
        expect(result.current.runtime.isReady).toBe(true)
      })

      let requestResult: unknown
      await act(async () => {
        // @ts-expect-error - request is not in IWallet interface
        requestResult = await result.current.wallet.request({
          method: 'eth_sendTransaction',
          params: [{ to: '0xRecipient', value: '0x1' }],
        })
      })

      expect(requestResult).toBe('0xResult')
    })
  })
})
