/**
 * Tests for useWalletFactory hook
 */

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { IWalletAuthentication } from '../interfaces/IWalletAuthentication'

import { useWalletFactory } from '../services/useWalletFactory'

// Mock all wallet hooks - must be hoisted
const mockMiniPayWallet = {
  wallet: {
    address: '0xMiniPayAddress',
    chainId: 'eip155:42220',
    connect: vi.fn(),
    disconnect: vi.fn(),
    signTransaction: vi.fn(),
    walletId: 'mini-pay',
  },
  runtime: {
    isReady: true,
    isResolving: false,
  },
}

const mockStellarKitWallet = {
  address: 'GStellarKitAddress',
  chainId: 'stellar:pubnet',
  connect: vi.fn(),
  disconnect: vi.fn(),
  signTransaction: vi.fn(),
  walletId: 'stellar-kit',
}

const mockWalletConnectWallet = {
  address: '0xWalletConnectAddress',
  chainId: 'eip155:42220',
  connect: vi.fn(),
  disconnect: vi.fn(),
  signTransaction: vi.fn(),
  walletId: 'wallet-connect',
}

const mockSep24Wallet = {
  address: '0xSep24Address',
  chainId: 'eip155:42220',
  connect: vi.fn(),
  disconnect: vi.fn(),
  signTransaction: vi.fn(),
  walletId: 'sep24',
}

const mockSolanaWallet = {
  wallet: {
    address: 'SolanaAddress',
    chainId: 'solana:mainnet',
    connect: vi.fn(),
    disconnect: vi.fn(),
    signTransaction: vi.fn(),
    walletId: 'solana',
  },
  error: null,
  isConnecting: false,
}

vi.mock('../services/wallets/useMiniPayWallet', () => ({
  useMiniPayWallet: vi.fn(() => mockMiniPayWallet),
}))

vi.mock('../services/wallets/useStellarKitWallet', () => ({
  useStellarKitWallet: vi.fn(() => mockStellarKitWallet),
}))

vi.mock('../services/wallets/useWalletConnectWallet', () => ({
  useWalletConnectWallet: vi.fn(() => mockWalletConnectWallet),
}))

vi.mock('../services/wallets/useSep24Wallet', () => ({
  useSep24Wallet: vi.fn(() => mockSep24Wallet),
}))

vi.mock('../services/wallets/useSolanaWallet', () => ({
  useSolanaWallet: vi.fn(() => mockSolanaWallet),
}))

describe('useWalletFactory', () => {
  const mockWalletAuth: IWalletAuthentication = {
    authenticate: vi.fn(),
    jwtToken: null,
    setJwtToken: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('wallet handlers', () => {
    it('should return MiniPay wallet handler', () => {
      const { result } = renderHook(() => useWalletFactory({ walletAuth: mockWalletAuth }))

      const miniPayWallet = result.current.getWalletHandler('mini-pay')

      expect(miniPayWallet).toBeDefined()
      expect(miniPayWallet.address).toBe('0xMiniPayAddress')
      expect(miniPayWallet.chainId).toBe('eip155:42220')
      expect(miniPayWallet.walletId).toBe('mini-pay')
    })

    it('should return Stellar Kit wallet handler', () => {
      const { result } = renderHook(() => useWalletFactory({ walletAuth: mockWalletAuth }))

      const stellarWallet = result.current.getWalletHandler('stellar-kit')

      expect(stellarWallet).toBeDefined()
      expect(stellarWallet.address).toBe('GStellarKitAddress')
      expect(stellarWallet.chainId).toBe('stellar:pubnet')
      expect(stellarWallet.walletId).toBe('stellar-kit')
    })

    it('should return Wallet Connect wallet handler', () => {
      const { result } = renderHook(() => useWalletFactory({ walletAuth: mockWalletAuth }))

      const wcWallet = result.current.getWalletHandler('wallet-connect')

      expect(wcWallet).toBeDefined()
      expect(wcWallet.address).toBe('0xWalletConnectAddress')
      expect(wcWallet.chainId).toBe('eip155:42220')
      expect(wcWallet.walletId).toBe('wallet-connect')
    })

    it('should return SEP-24 wallet handler', () => {
      const { result } = renderHook(() => useWalletFactory({ walletAuth: mockWalletAuth }))

      const sep24Wallet = result.current.getWalletHandler('sep24')

      expect(sep24Wallet).toBeDefined()
      expect(sep24Wallet.address).toBe('0xSep24Address')
      expect(sep24Wallet.chainId).toBe('eip155:42220')
      expect(sep24Wallet.walletId).toBe('sep24')
    })

    it('should return Solana wallet handler', () => {
      const { result } = renderHook(() => useWalletFactory({ walletAuth: mockWalletAuth }))

      const solanaWallet = result.current.getWalletHandler('solana')

      expect(solanaWallet).toBeDefined()
      expect(solanaWallet!.address).toBe('SolanaAddress')
      expect(solanaWallet!.chainId).toBe('solana:mainnet')
      expect(solanaWallet!.walletId).toBe('solana')
    })

    it('should throw error for unknown wallet type', () => {
      const { result } = renderHook(() => useWalletFactory({ walletAuth: mockWalletAuth }))

      expect(() => {
        // @ts-expect-error - Testing invalid wallet type
        result.current.getWalletHandler('unknown-wallet')
      }).toThrow('Unknown wallet type: unknown-wallet')
    })
  })

  describe('MiniPay runtime', () => {
    it('should expose MiniPay runtime state', () => {
      const { result } = renderHook(() => useWalletFactory({ walletAuth: mockWalletAuth }))

      expect(result.current.miniPay).toBeDefined()
      expect(result.current.miniPay.isReady).toBe(true)
      expect(result.current.miniPay.isResolving).toBe(false)
    })
  })

  describe('hook dependencies', () => {
    it('should initialize all wallet hooks on mount', async () => {
      renderHook(() => useWalletFactory({ walletAuth: mockWalletAuth }))

      // Verify all wallet hooks were called by checking the mocks
      expect(vi.mocked(await import('../services/wallets/useMiniPayWallet')).useMiniPayWallet)
        .toHaveBeenCalled()
      expect(vi.mocked(await import('../services/wallets/useStellarKitWallet')).useStellarKitWallet)
        .toHaveBeenCalledWith({ walletAuth: mockWalletAuth })
      expect(vi.mocked(await import('../services/wallets/useWalletConnectWallet')).useWalletConnectWallet)
        .toHaveBeenCalledWith({ walletAuth: mockWalletAuth })
      expect(vi.mocked(await import('../services/wallets/useSep24Wallet')).useSep24Wallet)
        .toHaveBeenCalledWith({ walletAuthentication: mockWalletAuth })
      expect(vi.mocked(await import('../services/wallets/useSolanaWallet')).useSolanaWallet)
        .toHaveBeenCalledWith(mockWalletAuth)
    })

    it('should return stable handler function reference', () => {
      const { result, rerender } = renderHook(
        () => useWalletFactory({ walletAuth: mockWalletAuth }),
      )

      const firstHandler = result.current.getWalletHandler
      rerender()
      const secondHandler = result.current.getWalletHandler

      // Handler should be memoized and stable across rerenders
      expect(firstHandler).toBe(secondHandler)
    })
  })

  describe('wallet methods', () => {
    it('should have connect method on returned wallet', () => {
      const { result } = renderHook(() => useWalletFactory({ walletAuth: mockWalletAuth }))

      const wallet = result.current.getWalletHandler('mini-pay')
      expect(wallet.connect).toBeDefined()
      expect(typeof wallet.connect).toBe('function')
    })

    it('should have disconnect method on returned wallet', () => {
      const { result } = renderHook(() => useWalletFactory({ walletAuth: mockWalletAuth }))

      const wallet = result.current.getWalletHandler('mini-pay')
      expect(wallet.disconnect).toBeDefined()
      expect(typeof wallet.disconnect).toBe('function')
    })

    it('should have signTransaction method on returned wallet', () => {
      const { result } = renderHook(() => useWalletFactory({ walletAuth: mockWalletAuth }))

      const wallet = result.current.getWalletHandler('mini-pay')
      expect(wallet.signTransaction).toBeDefined()
      expect(typeof wallet.signTransaction).toBe('function')
    })
  })
})
