/**
 * Tests for useSep24Wallet hook
 *
 * Note: Tests for URL parameter handling are limited because
 * window.location.search cannot be easily mocked in JSDOM.
 * These tests verify the core wallet interface and behavior.
 */

import { act, renderHook } from '@testing-library/react'
import {
  describe, expect, it, vi,
} from 'vitest'

import type { IWalletAuthentication } from '../interfaces/IWalletAuthentication'

import { useSep24Wallet } from '../services/wallets/useSep24Wallet'

const withMockUrlParams = (
  getter: (key: string) => null | string,
  callback: () => Promise<void> | void,
) => {
  const original = global.URLSearchParams
  global.URLSearchParams = vi.fn(() => ({ get: getter })) as unknown as typeof URLSearchParams
  try {
    return Promise.resolve(callback()).finally(() => {
      global.URLSearchParams = original
    })
  }
  catch (err) {
    global.URLSearchParams = original
    throw err
  }
}

describe('useSep24Wallet', () => {
  const mockSetJwtToken = vi.fn()
  const mockWalletAuth: IWalletAuthentication = {
    authenticate: vi.fn(),
    getAuthToken: vi.fn(),
    getChallengeMessage: vi.fn(),
    jwtToken: null,
    refreshAuthToken: vi.fn(),
    setJwtToken: mockSetJwtToken,
  }

  const renderSep24 = () =>
    renderHook(() => useSep24Wallet({ walletAuthentication: mockWalletAuth }))

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('wallet interface', () => {
    it('should have correct initial state', () => {
      const { result } = renderSep24()

      expect(result.current.address).toBe(null)
      expect(result.current.chainId).toBe('stellar:pubnet')
      expect(result.current.walletId).toBe('sep24')
    })

    it('should have connect method that is a no-op', async () => {
      const { result } = renderSep24()

      await act(async () => {
        await result.current.connect()
      })

      expect(mockSetJwtToken).not.toHaveBeenCalled()
    })

    it('should have disconnect method that is a no-op', async () => {
      const { result } = renderSep24()

      await act(async () => {
        await result.current.disconnect()
      })

      expect(mockSetJwtToken).not.toHaveBeenCalled()
    })

    it('should have signTransaction that closes window', async () => {
      const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => {})

      const { result } = renderSep24()

      let signedResult: undefined | { signedTxXdr?: string, signerAddress?: string }
      await act(async () => {
        signedResult = await result.current.signTransaction({ message: '0xTxToSign' })
      })

      expect(closeSpy).toHaveBeenCalled()
      expect(signedResult?.signedTxXdr).toBe('')
      expect(signedResult?.signerAddress).toBe(undefined)

      closeSpy.mockRestore()
    })
  })

  describe('wallet properties', () => {
    it('should use Stellar pubnet as chainId', () => {
      const { result } = renderSep24()

      expect(result.current.chainId).toBe('stellar:pubnet')
    })

    it('should always return sep24 as walletId', () => {
      const { result } = renderSep24()

      expect(result.current.walletId).toBe('sep24')
    })
  })

  describe('URL parameter parsing', () => {
    it('should set JWT token and address when both token and address are present in URL', async () => {
      await withMockUrlParams(
        (key) => {
          if (key === 'token') return 'test-jwt-token'
          if (key === 'address') return '0xTestAddress'
          return null
        },
        async () => {
          const { result } = renderSep24()
          await new Promise(resolve => setTimeout(resolve, 50))

          expect(result.current.address).toBe('0xTestAddress')
          expect(mockSetJwtToken).toHaveBeenCalledWith('test-jwt-token')
        },
      )
    })

    it('should not set token or address when URL params are missing', async () => {
      await withMockUrlParams(
        () => null,
        () => {
          const { result } = renderSep24()
          expect(result.current.address).toBe(null)
          expect(mockSetJwtToken).not.toHaveBeenCalled()
        },
      )
    })

    it('should not set address when only token is present (no address)', async () => {
      await withMockUrlParams(
        key => (key === 'token' ? 'test-token' : null),
        () => {
          const { result } = renderSep24()
          expect(result.current.address).toBe(null)
          expect(mockSetJwtToken).not.toHaveBeenCalled()
        },
      )
    })

    it('should not set token or address when only address is present (no token)', async () => {
      await withMockUrlParams(
        key => (key === 'address' ? '0xTestAddress' : null),
        () => {
          const { result } = renderSep24()
          expect(result.current.address).toBe(null)
          expect(mockSetJwtToken).not.toHaveBeenCalled()
        },
      )
    })
  })
})
