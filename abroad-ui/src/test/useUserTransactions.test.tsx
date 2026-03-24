/**
 * Tests for useUserTransactions hook
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useUserTransactions } from '../services/useUserTransactions'

// Mock the publicApi module
vi.mock('../services/public/publicApi', () => ({
  getUserTransactions: vi.fn(),
}))

import { getUserTransactions } from '../services/public/publicApi'

describe('useUserTransactions', () => {
  const mockTransactions = [
    {
      id: 'tx-001',
      onChainId: '0xabc123',
      status: 'PAYMENT_COMPLETED',
      createdAt: '2024-01-15T10:30:00Z',
      accountNumber: '1234567890',
      externalId: 'EXT-001',
      quote: {
        sourceAmount: 100,
        targetAmount: 500,
        cryptoCurrency: 'USDC',
        network: 'CELO',
        targetCurrency: 'BRL',
      },
    },
    {
      id: 'tx-002',
      onChainId: null,
      status: 'AWAITING_PAYMENT',
      createdAt: '2024-01-15T11:00:00Z',
      accountNumber: '0987654321',
      externalId: null,
      quote: {
        sourceAmount: 50,
        targetAmount: 250,
        cryptoCurrency: 'USDT',
        network: 'STELLAR',
        targetCurrency: 'COP',
      },
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('initial state', () => {
    it('should return empty transactions when not authenticated', () => {
      const { result } = renderHook(() => useUserTransactions(false))

      expect(result.current.transactions).toEqual([])
      expect(result.current.allTransactions).toEqual([])
      expect(result.current.isLoading).toBe(false)
      expect(result.current.error).toBe(null)
    })
  })

  describe('fetchTransactions', () => {
    it('should fetch transactions successfully when authenticated', async () => {
      vi.mocked(getUserTransactions).mockResolvedValue({
        ok: true,
        data: {
          transactions: mockTransactions,
          total: 2,
          page: 1,
          pageSize: 20,
        },
      })

      const { result } = renderHook(() => useUserTransactions(true))

      // Initial state
      expect(result.current.transactions).toEqual([])

      // Fetch transactions
      await act(async () => {
        await result.current.fetchTransactions()
      })

      expect(result.current.transactions).toEqual(mockTransactions)
      expect(result.current.isLoading).toBe(false)
      expect(result.current.error).toBe(null)
    })

    it('should handle fetch transactions error', async () => {
      vi.mocked(getUserTransactions).mockResolvedValue({
        ok: false,
        error: {
          message: 'Network error',
          status: 500,
        },
      })

      const { result } = renderHook(() => useUserTransactions(true))

      await act(async () => {
        await result.current.fetchTransactions()
      })

      expect(result.current.transactions).toEqual([])
      expect(result.current.error).toBe('Network error')
    })

    it('should not fetch when not authenticated', async () => {
      const { result } = renderHook(() => useUserTransactions(false))

      await act(async () => {
        await result.current.fetchTransactions()
      })

      expect(getUserTransactions).not.toHaveBeenCalled()
      expect(result.current.transactions).toEqual([])
    })

    it('should pass options to getUserTransactions', async () => {
      vi.mocked(getUserTransactions).mockResolvedValue({
        ok: true,
        data: { transactions: [], total: 0, page: 1, pageSize: 10 },
      })

      const { result } = renderHook(() => useUserTransactions(true))

      await act(async () => {
        await result.current.fetchTransactions({
          confirmedOnly: true,
          page: 2,
          pageSize: 10,
        })
      })

      expect(getUserTransactions).toHaveBeenCalledWith({
        confirmedOnly: true,
        page: 2,
        pageSize: 10,
      })
    })
  })

  describe('fetchAllTransactions', () => {
    it('should fetch all transactions successfully', async () => {
      vi.mocked(getUserTransactions).mockResolvedValue({
        ok: true,
        data: {
          transactions: mockTransactions,
          total: 2,
          page: 1,
          pageSize: 100,
        },
      })

      const { result } = renderHook(() => useUserTransactions(true))

      await act(async () => {
        await result.current.fetchAllTransactions()
      })

      expect(result.current.allTransactions.length).toBe(2)
      expect(result.current.isLoadingAll).toBe(false)
    })

    it('should handle fetch all transactions error', async () => {
      vi.mocked(getUserTransactions).mockResolvedValue({
        ok: false,
        error: {
          message: 'Failed to load history',
          status: 500,
        },
      })

      const { result } = renderHook(() => useUserTransactions(true))

      await act(async () => {
        await result.current.fetchAllTransactions()
      })

      expect(result.current.allTransactions).toEqual([])
      expect(result.current.error).toBe('Failed to load history')
    })

    it('should not fetch all when not authenticated', async () => {
      const { result } = renderHook(() => useUserTransactions(false))

      await act(async () => {
        await result.current.fetchAllTransactions()
      })

      expect(getUserTransactions).not.toHaveBeenCalled()
      expect(result.current.allTransactions).toEqual([])
    })

    it('should always fetch with confirmedOnly: false and pageSize: 100', async () => {
      vi.mocked(getUserTransactions).mockResolvedValue({
        ok: true,
        data: { transactions: [], total: 0, page: 1, pageSize: 100 },
      })

      const { result } = renderHook(() => useUserTransactions(true))

      await act(async () => {
        await result.current.fetchAllTransactions()
      })

      expect(getUserTransactions).toHaveBeenCalledWith({
        confirmedOnly: false,
        page: 1,
        pageSize: 100,
      })
    })
  })

  describe('filteredTransactions', () => {
    it('should filter transactions by chain when selectedChainKey provided', async () => {
      const celoAndStellarTransactions = [
        {
          ...mockTransactions[0], // CELO
          quote: { ...mockTransactions[0].quote, network: 'CELO' },
        },
        {
          ...mockTransactions[1], // STELLAR
          quote: { ...mockTransactions[1].quote, network: 'STELLAR' },
        },
      ]

      vi.mocked(getUserTransactions).mockResolvedValue({
        ok: true,
        data: {
          transactions: celoAndStellarTransactions,
          total: 2,
          page: 1,
          pageSize: 20,
        },
      })

      const { result } = renderHook(() => useUserTransactions(true, 'celo'))

      await act(async () => {
        await result.current.fetchTransactions()
      })

      // Should only show CELO transactions
      expect(result.current.transactions.length).toBe(2)
    })

    it('should not filter when selectedChainKey is undefined', async () => {
      vi.mocked(getUserTransactions).mockResolvedValue({
        ok: true,
        data: { transactions: mockTransactions, total: 2, page: 1, pageSize: 20 },
      })

      const { result } = renderHook(() => useUserTransactions(true, undefined))

      await act(async () => {
        await result.current.fetchTransactions()
      })

      expect(result.current.transactions).toEqual(mockTransactions)
    })
  })

  describe('recentTransactions', () => {
    it('should return max 2 most recent transactions', async () => {
      vi.mocked(getUserTransactions).mockResolvedValue({
        ok: true,
        data: {
          transactions: [
            { ...mockTransactions[0], createdAt: '2024-01-15T10:00:00Z' },
            { ...mockTransactions[1], createdAt: '2024-01-15T11:00:00Z' },
            { ...mockTransactions[0], id: 'tx-003', createdAt: '2024-01-15T12:00:00Z' },
          ],
          total: 3,
          page: 1,
          pageSize: 20,
        },
      })

      const { result } = renderHook(() => useUserTransactions(true))

      await act(async () => {
        await result.current.fetchTransactions()
      })

      expect(result.current.recentTransactions.length).toBe(2)
    })

    it('should map transactions to UserTransactionSummary format', async () => {
      vi.mocked(getUserTransactions).mockResolvedValue({
        ok: true,
        data: {
          transactions: [mockTransactions[0]],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      })

      const { result } = renderHook(() => useUserTransactions(true))

      await act(async () => {
        await result.current.fetchTransactions()
      })

      const summary = result.current.recentTransactions[0]
      expect(summary).toHaveProperty('country', 'BRL')
      expect(summary).toHaveProperty('localAmount', '500.00')
      expect(summary).toHaveProperty('usdcAmount', '100.00')
      expect(summary).toHaveProperty('merchant')
      expect(summary).toHaveProperty('time')
    })
  })

  describe('allTransactions mapping', () => {
    it('should map all transactions to detail format', async () => {
      vi.mocked(getUserTransactions).mockResolvedValue({
        ok: true,
        data: {
          transactions: [mockTransactions[0]],
          total: 1,
          page: 1,
          pageSize: 100,
        },
      })

      const { result } = renderHook(() => useUserTransactions(true))

      await act(async () => {
        await result.current.fetchAllTransactions()
      })

      expect(result.current.allTransactions.length).toBe(1)
      expect(result.current.allTransactions[0]).toHaveProperty('transactionId')
      expect(result.current.allTransactions[0]).toHaveProperty('chain', 'Celo')
      expect(result.current.allTransactions[0]).toHaveProperty('country', 'br')
      expect(result.current.allTransactions[0]).toHaveProperty('status')
    })

    it('should map transaction status correctly', async () => {
      const transactionsWithDifferentStatus = [
        { ...mockTransactions[0], status: 'AWAITING_PAYMENT' as const },
        { ...mockTransactions[0], status: 'PAYMENT_COMPLETED' as const, id: 'tx-002' },
        { ...mockTransactions[0], status: 'PAYMENT_EXPIRED' as const, id: 'tx-003' },
      ]

      vi.mocked(getUserTransactions).mockResolvedValue({
        ok: true,
        data: {
          transactions: transactionsWithDifferentStatus,
          total: 3,
          page: 1,
          pageSize: 100,
        },
      })

      const { result } = renderHook(() => useUserTransactions(true))

      await act(async () => {
        await result.current.fetchAllTransactions()
      })

      expect(result.current.allTransactions[0].status).toBe('pending')
      expect(result.current.allTransactions[1].status).toBe('completed')
      expect(result.current.allTransactions[2].status).toBe('expired')
    })
  })

  describe('date formatting', () => {
    it('should format recent dates correctly', async () => {
      const now = new Date()
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString()

      vi.mocked(getUserTransactions).mockResolvedValue({
        ok: true,
        data: {
          transactions: [{ ...mockTransactions[0], createdAt: fiveMinutesAgo }],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      })

      const { result } = renderHook(() => useUserTransactions(true))

      await act(async () => {
        await result.current.fetchTransactions()
      })

      expect(result.current.recentTransactions[0].time).toMatch(/5m ago/)
    })

    it('should format older dates correctly', async () => {
      const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()

      vi.mocked(getUserTransactions).mockResolvedValue({
        ok: true,
        data: {
          transactions: [{ ...mockTransactions[0], createdAt: fiveHoursAgo }],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      })

      const { result } = renderHook(() => useUserTransactions(true))

      await act(async () => {
        await result.current.fetchTransactions()
      })

      expect(result.current.recentTransactions[0].time).toMatch(/5h ago/)
    })
  })
})
