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

type Balances = { cUSD: string, USDC: string, USDT: string }

const ZERO_BALANCES: Balances = { cUSD: '0.00', USDC: '0.00', USDT: '0.00' }

const renderBalances = (address: null | string | undefined, chainId: null | string) =>
  renderHook(() => useStablecoinBalances({ address, chainId }))

const setupBalances = async (
  balances: Balances,
  { address, chainId }: { address: null | string, chainId: null | string },
) => {
  vi.mocked(fetchNonStellarBalances).mockResolvedValue(balances)
  const { result } = renderBalances(address, chainId)
  await waitFor(() => {
    expect(result.current.isLoading).toBe(false)
  })
  return result
}

describe('useStablecoinBalances', () => {
  const mockSolanaAddress = 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH'
  const mockEvmAddress = '0x1234567890123456789012345678901234567890'
  const SOLANA = { address: mockSolanaAddress, chainId: 'solana:mainnet' }
  const EVM = { address: mockEvmAddress, chainId: 'eip155:42220' }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should return empty balances when no address provided', () => {
      const { result } = renderBalances(null, null)

      expect(result.current.balances).toEqual(ZERO_BALANCES)
      expect(result.current.isLoading).toBe(false)
      expect(result.current.error).toBe(null)
    })

    it('should return empty balances when address is undefined', () => {
      const { result } = renderBalances(undefined, 'stellar:pubnet')

      expect(result.current.balances).toEqual(ZERO_BALANCES)
    })
  })

  describe('Solana balance fetching', () => {
    it('should fetch Solana balances successfully', async () => {
      const result = await setupBalances({ cUSD: '0.00', USDC: '200.00', USDT: '50.00' }, SOLANA)

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

      const { result } = renderBalances(mockSolanaAddress, 'solana:mainnet')

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.balances).toEqual(ZERO_BALANCES)
    })
  })

  describe('EVM balance fetching', () => {
    it('should fetch EVM balances successfully', async () => {
      const result = await setupBalances({ cUSD: '100.00', USDC: '300.00', USDT: '75.00' }, EVM)

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
      const result = await setupBalances({ cUSD: '10.00', USDC: '500.00', USDT: '100.00' }, EVM)

      expect(result.current.preference.highestBalanceToken).toBe('USDC')
      expect(result.current.preference.kind).toBe('supported')
    })

    it('should prefer USDT when it has the highest balance', async () => {
      const result = await setupBalances({ cUSD: '10.00', USDC: '50.00', USDT: '500.00' }, EVM)

      expect(result.current.preference.highestBalanceToken).toBe('USDT')
      expect(result.current.preference.kind).toBe('supported')
    })

    it('should default to USDC when all balances are zero', async () => {
      const result = await setupBalances(ZERO_BALANCES, EVM)

      expect(result.current.preference.highestBalanceToken).toBe('USDC')
      expect(result.current.preference.kind).toBe('empty')
    })
  })

  describe('supportedBalanceFor', () => {
    it('should return balance for requested symbol', async () => {
      const result = await setupBalances({ cUSD: '25.00', USDC: '100.00', USDT: '50.00' }, EVM)

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

      const { result } = renderBalances(mockEvmAddress, 'eip155:42220')

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      const initialBalance = result.current.balances.USDC

      await act(async () => {
        await result.current.refresh()
      })

      expect(result.current.balances.USDC).not.toBe(initialBalance)
    })

    it('should clear balances when address becomes null', async () => {
      vi.mocked(fetchNonStellarBalances).mockResolvedValue({ cUSD: '0.00', USDC: '100.00', USDT: '0.00' })

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

      rerender({ address: null, chainId: null })

      await waitFor(() => {
        expect(result.current.balances).toEqual(ZERO_BALANCES)
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

      await waitFor(() => {
        expect(callCount).toBe(1)
      })

      rerender({ address: mockSolanaAddress })

      await waitFor(() => {
        expect(callCount).toBe(2)
      })

      if (resolveSecond) resolveSecond()
      if (resolveFirst) resolveFirst()

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false)
      })

      expect(result.current.balances.USDC).toBe('200.00')
    })
  })
})
