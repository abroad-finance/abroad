import { act, renderHook } from '@testing-library/react'
import {
  afterEach, beforeEach, describe, expect, it, vi,
} from 'vitest'

import { useVersionCheck } from '../useVersionCheck'

// Mock NoticeContext
const mockAddNotice = vi.fn()
vi.mock('../../../contexts/NoticeContext', () => ({
  useNotices: () => ({ addNotice: mockAddNotice, clearNotices: vi.fn(), removeNotice: vi.fn() }),
}))

describe('useVersionCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockAddNotice.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('does not show a notice on first load', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ version: 'abc123' }), { status: 200 }),
    )

    renderHook(() => useVersionCheck({ pollingIntervalMs: 1000 }))
    await act(() => vi.advanceTimersByTimeAsync(100))

    expect(mockAddNotice).not.toHaveBeenCalled()
  })

  it('shows a notice when version changes', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 'v1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 'v2' }), { status: 200 }))

    // Use a mutable view prop so we can trigger a rerender that fires the notice effect
    const { rerender } = renderHook(
      ({ view }) => useVersionCheck({ currentView: view, pollingIntervalMs: 1000 }),
      { initialProps: { view: 'swap' } },
    )

    // First fetch sets baseline
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(mockAddNotice).not.toHaveBeenCalled()

    // Second fetch detects change (sets updateDetectedRef)
    await act(() => vi.advanceTimersByTimeAsync(1000))

    // Rerender to trigger the notice-showing effect with updated ref
    rerender({ view: 'swap' })

    expect(mockAddNotice).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'info', message: 'A new version is available' }),
    )
  })

  it('suppresses notice during txStatus view', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 'v1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: 'v2' }), { status: 200 }))

    const { rerender } = renderHook(
      ({ view }) => useVersionCheck({ currentView: view, pollingIntervalMs: 1000, suppressWhileViews: ['txStatus'] }),
      { initialProps: { view: 'txStatus' } },
    )

    await act(() => vi.advanceTimersByTimeAsync(100))
    await act(() => vi.advanceTimersByTimeAsync(1000))

    // Rerender while still on txStatus - should stay suppressed
    rerender({ view: 'txStatus' })
    expect(mockAddNotice).not.toHaveBeenCalled()

    // Navigate away from txStatus
    rerender({ view: 'swap' })
    expect(mockAddNotice).toHaveBeenCalledTimes(1)
  })

  it('ignores fetch failures silently', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))

    renderHook(() => useVersionCheck({ pollingIntervalMs: 1000 }))
    await act(() => vi.advanceTimersByTimeAsync(100))

    expect(mockAddNotice).not.toHaveBeenCalled()
  })
})
