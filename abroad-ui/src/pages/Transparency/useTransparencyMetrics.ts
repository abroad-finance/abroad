import {
  useCallback, useEffect, useRef, useState,
} from 'react'

import type { TransparencyMetricsResponse } from '../../api'

import { fetchTransparencyMetrics } from '../../services/public/transparencyApi'

type TransparencyMetricsState = {
  data: null | TransparencyMetricsResponse
  error: null | string
  isLoading: boolean
  isRefreshing: boolean
}

type UseTransparencyMetricsResult = TransparencyMetricsState & {
  refresh: () => Promise<void>
}

const INITIAL_STATE: TransparencyMetricsState = {
  data: null,
  error: null,
  isLoading: true,
  isRefreshing: false,
}

export const useTransparencyMetrics = (): UseTransparencyMetricsResult => {
  const [state, setState] = useState<TransparencyMetricsState>(INITIAL_STATE)
  const activeRequest = useRef<AbortController | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller

    setState(previous => ({
      ...previous,
      error: null,
      isLoading: previous.data === null,
      isRefreshing: previous.data !== null,
    }))

    try {
      const data = await fetchTransparencyMetrics(controller.signal)
      if (controller.signal.aborted) return

      setState({
        data,
        error: null,
        isLoading: false,
        isRefreshing: false,
      })
    }
    catch (error) {
      if (controller.signal.aborted) return

      setState(previous => ({
        ...previous,
        error: error instanceof Error
          ? error.message
          : 'Current transparency metrics are unavailable',
        isLoading: false,
        isRefreshing: false,
      }))
    }
    finally {
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }, [])

  useEffect(() => {
    void refresh()
    return () => activeRequest.current?.abort()
  }, [refresh])

  useEffect(() => {
    if (!state.data) return undefined

    const delayMs = Math.max(1, state.data.refreshAfterSeconds) * 1_000
    const timer = window.setTimeout(() => {
      void refresh()
    }, delayMs)

    return () => window.clearTimeout(timer)
  }, [refresh, state.data])

  return {
    ...state,
    refresh,
  }
}
