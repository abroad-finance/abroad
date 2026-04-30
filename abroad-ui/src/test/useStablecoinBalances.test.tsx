/**
 * Tests for useStablecoinBalances hook
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import {
  describe, expect, it, vi,
} from 'vitest'

import { useStablecoinBalances } from '../features/swap/hooks/useStablecoinBalances'

// Mock the chainBalanceFetchers module - must be hoisted
vi.mock('../features/swap/lib/chainBalanceFetchers', () => ({
  fetchNonStellarBalances: vi.fn().mockResolvedValue({
    cUSD: '0.00',
    USDC: '0.00',
    USDT: '0.00',
  }),
}))

import { fetchNonStellarBalances } from '../features/swap/lib/chainBalanceFetchers'

// Note: We can't easily mock @stellar/stellar-sdk here because it's imported
// and used directly in the hook. The hook has its own internal handling for
// Stellar balance fetching. These tests focus on Solana and EVM chains.

describe('useStablecoinBalances', () => {
  const mockSolanaAddress = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH'
  const mockEvmAddress = '0x1234567890123456789012345678901234567890'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should return empty balances when no address provided', () => {
      const { result } = renderHook(() => useStablecoinBalances({ address: null, chainId: null }))

      expect(result.current.balances).toEqual({
        cUSD: '0.00',
        USDC: '0.00',
        USDT: '0.00',
      })
      expect(result.current.isLoading).toBe(false)
      expect(result.current.error).toBe(null)
    })

    it('should return empty balances when address is undefined', () => {
      const { result } = renderHook(() =>
        useStablecoinBalances({ address: undefined, chainId: 'stellar:pubnet' }),
      )

      expect(result.current.balances).toEqual({
        cUSD: '0.00',
        USDC: '0.00',
        USDT: '0.00',
      })
    })
  })

  describe('Solana balance fetching', () => {
    it('should fetch Solana balances successfully', async () => {
      vi.mocked(fetchNonStellarBalances).mockResolvedValue({
        cUSD: '0.00',
        USDC: '200.00',
        USDT: '50.00',
      })

      const { result } = renderHook(() =>
        useStablecoinBalances({ address: mockSolanaAddress, chainId: 'solana:mainnet' }),
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(fetchNonStellarBalances).toHaveBeenCalledWith(
        mockSolanaAddress,
        'solana:mainnet',
        'solana',
      )
      expect(result.current.balances.USDC).toBe('200.00')
      expect(result.current.balances.USDT).toBe('50.00')
    })

    it('should handle Solana fetch error', async () => {
      vi.mocked(fetchNonStellarBalances).mockRejectedValue(new Error('RPC error'))

      const { result } = renderHook(() =>
        useStablecoinBalances({ address: mockSolanaAddress, chainId: 'solana:mainnet' }),
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.balances).toEqual({
        cUSD: '0.00',
        USDC: '0.00',
        USDT: '0.00',
      })
    })
  })

  describe('EVM balance fetching', () => {
    it('should fetch EVM balances successfully', async () => {
      vi.mocked(fetchNonStellarBalances).mockResolvedValue({
        cUSD: '100.00',
        USDC: '300.00',
        USDT: '75.00',
      })

      const { result } = renderHook(() =>
        useStablecoinBalances({ address: mockEvmAddress, chainId: 'eip155:42220' }),
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(fetchNonStellarBalances).toHaveBeenCalledWith(
        mockEvmAddress,
        'eip155:42220',
        'evm',
      )
      expect(result.current.balances.cUSD).toBe('100.00')
      expect(result.current.balances.USDC).toBe('300.00')
    })
  })

  describe('preference resolution', () => {
    it('should prefer USDC when it has the highest balance', async () => {
      vi.mocked(fetchNonStellarBalances).mockResolvedValue({
        cUSD: '10.00',
        USDC: '500.00',
        USDT: '100.00',
      })

      const { result } = renderHook(() =>
        useStablecoinBalances({ address: mockEvmAddress, chainId: 'eip155:42220' }),
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.preference.highestBalanceToken).toBe('USDC')
      expect(result.current.preference.kind).toBe('supported')
    })

    it('should prefer USDT when it has the highest balance', async () => {
      vi.mocked(fetchNonStellarBalances).mockResolvedValue({
        cUSD: '10.00',
        USDC: '50.00',
        USDT: '500.00',
      })

      const { result } = renderHook(() =>
        useStablecoinBalances({ address: mockEvmAddress, chainId: 'eip155:42220' }),
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.preference.highestBalanceToken).toBe('USDT')
      expect(result.current.preference.kind).toBe('supported')
    })

    it('should default to USDC when all balances are zero', async () => {
      vi.mocked(fetchNonStellarBalances).mockResolvedValue({
        cUSD: '0.00',
        USDC: '0.00',
        USDT: '0.00',
      })

      const { result } = renderHook(() =>
        useStablecoinBalances({ address: mockEvmAddress, chainId: 'eip155:42220' }),
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.preference.highestBalanceToken).toBe('USDC')
      expect(result.current.preference.kind).toBe('empty')
    })
  })

  describe('supportedBalanceFor', () => {
    it('should return balance for requested symbol', async () => {
      vi.mocked(fetchNonStellarBalances).mockResolvedValue({
        cUSD: '25.00',
        USDC: '100.00',
        USDT: '50.00',
      })

      const { result } = renderHook(() =>
        useStablecoinBalances({ address: mockEvmAddress, chainId: 'eip155:42220' }),
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.supportedBalanceFor('USDC')).toBe('100.00')
      expect(result.current.supportedBalanceFor('USDT')).toBe('50.00')
    })
  })

  describe('refresh function', () => {
    it('should refresh balances when called', async () => {
      let callCount = 0
      vi.mocked(fetchNonStellarBalances).mockImplementation(async () => {
        callCount++
        return {
          cUSD: '0.00',
          USDC: `${callCount * 100}.00`,
          USDT: '0.00',
        }
      })

      const { result } = renderHook(() =>
        useStablecoinBalances({ address: mockEvmAddress, chainId: 'eip155:42220' }),
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const initialBalance = result.current.balances.USDC

      // Refresh
      await act(async () => {
        await result.current.refresh()
      })

      expect(result.current.balances.USDC).not.toBe(initialBalance)
    })

    it('should clear balances when address becomes null', async () => {
      vi.mocked(fetchNonStellarBalances).mockResolvedValue({
        cUSD: '0.00',
        USDC: '100.00',
        USDT: '0.00',
      })

      const { rerender, result } = renderHook(
        ({ address, chainId }: { address: null | string, chainId: null | string }) => useStablecoinBalances({ address, chainId }),
        {
          initialProps: { address: mockEvmAddress as null | string, chainId: 'eip155:42220' as null | string },
        },
      )

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.balances.USDC).toBe('100.00')

      // Change address to null
      rerender({ address: null, chainId: null })

      await waitFor(() => {
        expect(result.current.balances).toEqual({
          cUSD: '0.00',
          USDC: '0.00',
          USDT: '0.00',
        })
      })
    })
  })

  describe('race condition handling', () => {
    it('should ignore stale responses when address changes rapidly', async () => {
      let resolveFirst: (() => void) | undefined
      let resolveSecond: (() => void) | undefined
      let callCount = 0

      vi.mocked(fetchNonStellarBalances).mockImplementation(async () => {
        callCount++
        const currentCall = callCount
        return new Promise((resolve) => {
          if (currentCall === 1) {
            resolveFirst = () => resolve({ cUSD: '0.00', USDC: '100.00', USDT: '0.00' })
          }
          else {
            resolveSecond = () => resolve({ cUSD: '0.00', USDC: '200.00', USDT: '0.00' })
          }
        })
      })

      const { rerender, result } = renderHook(
        ({ address }) => useStablecoinBalances({ address, chainId: 'eip155:42220' }),
        {
          initialProps: { address: mockEvmAddress },
        },
      )

      // First request starts (callCount = 1, requestId = 1)
      // Wait for the mock to be called
      await waitFor(() => {
        expect(callCount).toBe(1)
      })

      // Change address before first request completes - this triggers second request (callCount = 2, requestId = 2)
      rerender({ address: mockSolanaAddress })

      // Wait for second request to start
      await waitFor(() => {
        expect(callCount).toBe(2)
      })

      // Resolve both requests - SECOND first (should win), then FIRST (should be ignored)
      if (resolveSecond) resolveSecond()
      if (resolveFirst) resolveFirst()

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      // Should use the second (most recent) response due to requestIdRef race condition prevention
      expect(result.current.balances.USDC).toBe('200.00')
    })
  })
})
