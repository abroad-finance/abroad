import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import type {
  ConsumerActivityReceiptDto,
  ConsumerActivityTransactionDto,
  ListConsumerActivityParams,
  PartnerPixReceiptDto,
} from '@/api'

import {
  getConsumerActivity,
  getConsumerActivityReceipt,
  listConsumerActivity,
} from '@/api'
import { useWebSocketSubscription } from '@/contexts/WebSocketContext'
import {
  parseConsumerActivityList,
  parseConsumerActivityReceipt,
} from '@/features/activity/model/activityContracts'
import {
  bucketCount,
  bucketLatencyMilliseconds,
  createTelemetrySessionKey,
  normalizeConsumerUxRail,
  recordConsumerUxEvent,
} from '@/observability/consumerUxTelemetry'
import { useWalletAuth } from '@/shared/hooks/useWalletAuth'

export type ConsumerActivityDetailStatus
  = | 'error'
    | 'loading'
    | 'offline'
    | 'ready'
    | 'stale'
    | 'unauthenticated'

export type ConsumerActivityListStatus
  = | 'empty'
    | 'error'
    | 'loading'
    | 'offline'
    | 'ready'
    | 'stale'
    | 'unauthenticated'

type ConsumerActivityDetailState = {
  error: null | string
  lastUpdatedAt: Date | null
  receipt: ConsumerActivityReceiptDto | null
  status: ConsumerActivityDetailStatus
}

type ConsumerActivityListOptions = {
  accumulatePages?: boolean
}

type ConsumerActivityListState = {
  error: null | string
  items: ConsumerActivityTransactionDto[]
  lastUpdatedAt: Date | null
  page: number
  pageSize: number
  status: ConsumerActivityListStatus
  total: number
}

const readFailureReason = (data: unknown, fallback: string): string => {
  if (
    typeof data === 'object'
    && data !== null
    && 'reason' in data
    && typeof data.reason === 'string'
    && data.reason.trim().length > 0
  ) {
    return data.reason
  }
  return fallback
}

const initialListState = (authenticated: boolean): ConsumerActivityListState => ({
  error: null,
  items: [],
  lastUpdatedAt: null,
  page: 1,
  pageSize: 20,
  status: authenticated ? 'loading' : 'unauthenticated',
  total: 0,
})

const initialDetailState = (authenticated: boolean): ConsumerActivityDetailState => ({
  error: null,
  lastUpdatedAt: null,
  receipt: null,
  status: authenticated ? 'loading' : 'unauthenticated',
})

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024

const browserIsOffline = (): boolean => (
  typeof navigator !== 'undefined' && navigator.onLine === false
)

const activityFilterDimension = (
  filters: ListConsumerActivityParams,
): 'all' | 'breb' | 'completed' | 'date_range' | 'failed' | 'pix' | 'processing' | 'refunded' => {
  if (filters.paymentMethod === 'PIX') return 'pix'
  if (filters.paymentMethod === 'BREB') return 'breb'
  if (filters.createdFrom || filters.createdTo) return 'date_range'
  if (filters.status === 'PAYMENT_COMPLETED') return 'completed'
  if (filters.status === 'PROCESSING_PAYMENT' || filters.status === 'AWAITING_PAYMENT') return 'processing'
  if (
    filters.status === 'PAYMENT_FAILED'
    || filters.status === 'PAYMENT_EXPIRED'
    || filters.status === 'WRONG_AMOUNT'
  ) return 'failed'
  return 'all'
}

const safeReceiptFileName = (fileName: string): string => (
  /^[a-zA-Z0-9._-]+\.pdf$/.test(fileName)
    ? fileName
    : 'abroad-payment-receipt.pdf'
)

export const savePdfReceipt = (receipt: PartnerPixReceiptDto): void => {
  if (
    receipt.contentType !== 'application/pdf'
    || !Number.isInteger(receipt.sizeBytes)
    || receipt.sizeBytes < 5
    || receipt.sizeBytes > MAX_RECEIPT_BYTES
  ) {
    throw new Error('The receipt file is invalid.')
  }

  let decoded: string
  try {
    decoded = window.atob(receipt.contentBase64)
  }
  catch {
    throw new Error('The receipt file is invalid.')
  }
  if (decoded.length !== receipt.sizeBytes || !decoded.startsWith('%PDF-')) {
    throw new Error('The receipt file is invalid.')
  }

  const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: receipt.contentType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = safeReceiptFileName(receipt.fileName)
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export const useConsumerActivityList = (
  filters: ListConsumerActivityParams,
  options: ConsumerActivityListOptions = {},
) => {
  const { walletAuthentication } = useWalletAuth()
  const authenticated = Boolean(walletAuthentication?.jwtToken)
  const [state, setState] = useState<ConsumerActivityListState>(() => initialListState(authenticated))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const itemsRef = useRef<ConsumerActivityTransactionDto[]>([])
  const telemetrySessionKeyRef = useRef(createTelemetrySessionKey())
  const previousQueryIdentityRef = useRef<null | string>(null)

  const {
    createdFrom,
    createdTo,
    network,
    page,
    pageSize,
    paymentMethod,
    sort,
    status,
    targetCurrency,
  } = filters
  const filterDimension = activityFilterDimension(filters)
  const queryIdentity = JSON.stringify({
    createdFrom,
    createdTo,
    network,
    pageSize,
    paymentMethod,
    sort,
    status,
    targetCurrency,
  })

  const load = useCallback(async (retainData: boolean): Promise<void> => {
    if (!walletAuthentication?.jwtToken) {
      itemsRef.current = []
      setState(initialListState(false))
      return
    }
    abortControllerRef.current?.abort()
    const abortController = new AbortController()
    const startedAt = performance.now()
    abortControllerRef.current = abortController
    if (retainData) {
      setIsRefreshing(true)
    }
    else {
      itemsRef.current = []
      setState(initialListState(true))
    }

    try {
      const pages = options.accumulatePages
        ? Array.from({ length: page ?? 1 }, (_, index) => index + 1)
        : [page ?? 1]
      const accumulatedItems: ConsumerActivityTransactionDto[] = []
      let responsePageSize = pageSize ?? 20
      let responseTotal = 0
      for (const requestedPage of pages) {
        const response = await listConsumerActivity({
          createdFrom,
          createdTo,
          network,
          page: requestedPage,
          pageSize,
          paymentMethod,
          sort,
          status,
          targetCurrency,
        }, { signal: abortController.signal })
        if (abortController.signal.aborted) return
        if (response.status !== 200) {
          const error = readFailureReason(response.data, 'Unable to load Activity right now.')
          const nextStatus = browserIsOffline()
            ? 'offline'
            : retainData && itemsRef.current.length > 0
              ? 'stale'
              : 'error'
          setState(previous => ({
            ...previous,
            error,
            status: nextStatus,
          }))
          const sessionKey = telemetrySessionKeyRef.current
          if (sessionKey) {
            recordConsumerUxEvent({
              dimensions: {
                filter: filterDimension,
                latency_bucket: bucketLatencyMilliseconds(performance.now() - startedAt),
                loaded_count_bucket: bucketCount(itemsRef.current.length),
                outcome: nextStatus === 'stale' ? 'stale' : nextStatus === 'offline' ? 'unavailable' : 'error',
                rail: normalizeConsumerUxRail(paymentMethod),
                total_count_bucket: 'unknown',
              },
              name: 'activity_page_outcome',
              session: { key: sessionKey, kind: 'activity' },
            })
          }
          return
        }
        const parsedResponse = parseConsumerActivityList(response.data)
        responsePageSize = parsedResponse.pageSize
        responseTotal = parsedResponse.total
        accumulatedItems.push(...parsedResponse.items)
        if (accumulatedItems.length >= responseTotal) break
      }

      const uniqueItems = [...new Map(accumulatedItems.map(item => [item.id, item])).values()]
      itemsRef.current = uniqueItems
      setState({
        error: null,
        items: uniqueItems,
        lastUpdatedAt: new Date(),
        page: page ?? 1,
        pageSize: responsePageSize,
        status: uniqueItems.length === 0 ? 'empty' : 'ready',
        total: responseTotal,
      })
      const sessionKey = telemetrySessionKeyRef.current
      if (sessionKey) {
        recordConsumerUxEvent({
          dimensions: {
            filter: filterDimension,
            latency_bucket: bucketLatencyMilliseconds(performance.now() - startedAt),
            loaded_count_bucket: bucketCount(uniqueItems.length),
            outcome: uniqueItems.length === 0
              ? filterDimension === 'all' ? 'empty' : 'filtered_empty'
              : 'success',
            rail: normalizeConsumerUxRail(paymentMethod),
            total_count_bucket: bucketCount(responseTotal),
          },
          name: 'activity_page_outcome',
          session: { key: sessionKey, kind: 'activity' },
        })
      }
    }
    catch {
      if (abortController.signal.aborted) {
        return
      }
      const nextStatus = browserIsOffline()
        ? 'offline'
        : retainData && itemsRef.current.length > 0
          ? 'stale'
          : 'error'
      setState(previous => ({
        ...previous,
        error: 'Unable to load Activity right now.',
        status: nextStatus,
      }))
      const sessionKey = telemetrySessionKeyRef.current
      if (sessionKey) {
        recordConsumerUxEvent({
          dimensions: {
            filter: filterDimension,
            latency_bucket: bucketLatencyMilliseconds(performance.now() - startedAt),
            loaded_count_bucket: bucketCount(itemsRef.current.length),
            outcome: nextStatus === 'stale' ? 'stale' : nextStatus === 'offline' ? 'unavailable' : 'error',
            rail: normalizeConsumerUxRail(paymentMethod),
            total_count_bucket: 'unknown',
          },
          name: 'activity_page_outcome',
          session: { key: sessionKey, kind: 'activity' },
        })
      }
    }
    finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null
        setIsRefreshing(false)
      }
    }
  }, [
    createdFrom,
    createdTo,
    network,
    page,
    pageSize,
    paymentMethod,
    sort,
    status,
    targetCurrency,
    filterDimension,
    options.accumulatePages,
    walletAuthentication?.jwtToken,
  ])

  useEffect(() => {
    const retainForAdditionalPage = options.accumulatePages === true
      && previousQueryIdentityRef.current === queryIdentity
      && (page ?? 1) > 1
    previousQueryIdentityRef.current = queryIdentity
    void load(retainForAdditionalPage)
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [
    load,
    options.accumulatePages,
    page,
    queryIdentity,
  ])

  const refresh = useCallback(() => load(true), [load])
  useWebSocketSubscription('transaction.created', refresh)
  useWebSocketSubscription('transaction.updated', refresh)

  return {
    ...state,
    isRefreshing,
    refresh,
    telemetrySessionKey: telemetrySessionKeyRef.current,
  }
}

export const useConsumerActivityDetail = (transactionId: string) => {
  const { walletAuthentication } = useWalletAuth()
  const authenticated = Boolean(walletAuthentication?.jwtToken)
  const [state, setState] = useState<ConsumerActivityDetailState>(() => initialDetailState(authenticated))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)
  const receiptRef = useRef<ConsumerActivityReceiptDto | null>(null)
  const telemetrySessionKeyRef = useRef(createTelemetrySessionKey())

  const load = useCallback(async (retainData: boolean): Promise<void> => {
    if (!walletAuthentication?.jwtToken) {
      receiptRef.current = null
      setState(initialDetailState(false))
      return
    }
    if (!transactionId) {
      receiptRef.current = null
      setState({
        error: 'The payment identifier is missing.',
        lastUpdatedAt: null,
        receipt: null,
        status: 'error',
      })
      return
    }

    abortControllerRef.current?.abort()
    const abortController = new AbortController()
    const startedAt = performance.now()
    abortControllerRef.current = abortController
    if (retainData) {
      setIsRefreshing(true)
    }
    else {
      receiptRef.current = null
      setState(initialDetailState(true))
    }

    try {
      const response = await getConsumerActivity(transactionId, { signal: abortController.signal })
      if (abortController.signal.aborted) {
        return
      }
      if (response.status !== 200) {
        const error = readFailureReason(response.data, 'Unable to load this Activity item.')
        const nextStatus = browserIsOffline()
          ? 'offline'
          : retainData && receiptRef.current
            ? 'stale'
            : 'error'
        setState(previous => ({
          ...previous,
          error,
          status: nextStatus,
        }))
        const sessionKey = telemetrySessionKeyRef.current
        if (sessionKey) {
          recordConsumerUxEvent({
            dimensions: {
              entry_surface: 'direct_link',
              latency_bucket: bucketLatencyMilliseconds(performance.now() - startedAt),
              outcome: nextStatus === 'stale' ? 'stale' : nextStatus === 'offline' ? 'unavailable' : 'error',
            },
            name: 'activity_page_outcome',
            session: { key: sessionKey, kind: 'activity' },
          })
        }
        return
      }

      const parsedReceipt = parseConsumerActivityReceipt(response.data)
      receiptRef.current = parsedReceipt
      setState({
        error: null,
        lastUpdatedAt: new Date(),
        receipt: parsedReceipt,
        status: 'ready',
      })
      const sessionKey = telemetrySessionKeyRef.current
      if (sessionKey) {
        recordConsumerUxEvent({
          dimensions: {
            entry_surface: 'direct_link',
            latency_bucket: bucketLatencyMilliseconds(performance.now() - startedAt),
            outcome: 'success',
            rail: normalizeConsumerUxRail(parsedReceipt.quote.paymentMethod),
            status: parsedReceipt.status === 'PAYMENT_COMPLETED'
              ? 'COMPLETED'
              : parsedReceipt.status === 'PAYMENT_EXPIRED'
                ? 'EXPIRED'
                : parsedReceipt.status === 'PAYMENT_FAILED'
                  ? 'FAILED'
                  : parsedReceipt.status === 'PROCESSING_PAYMENT'
                    ? 'PROCESSING'
                    : parsedReceipt.status === 'AWAITING_PAYMENT'
                      ? 'PENDING'
                      : 'UNKNOWN',
          },
          name: 'activity_detail_restored',
          session: { key: sessionKey, kind: 'activity' },
        })
      }
    }
    catch {
      if (abortController.signal.aborted) {
        return
      }
      const nextStatus = browserIsOffline()
        ? 'offline'
        : retainData && receiptRef.current
          ? 'stale'
          : 'error'
      setState(previous => ({
        ...previous,
        error: 'Unable to load this Activity item.',
        status: nextStatus,
      }))
      const sessionKey = telemetrySessionKeyRef.current
      if (sessionKey) {
        recordConsumerUxEvent({
          dimensions: {
            entry_surface: 'direct_link',
            latency_bucket: bucketLatencyMilliseconds(performance.now() - startedAt),
            outcome: nextStatus === 'stale' ? 'stale' : nextStatus === 'offline' ? 'unavailable' : 'error',
          },
          name: 'activity_page_outcome',
          session: { key: sessionKey, kind: 'activity' },
        })
      }
    }
    finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null
        setIsRefreshing(false)
      }
    }
  }, [transactionId, walletAuthentication?.jwtToken])

  useEffect(() => {
    void load(false)
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [load])

  const refresh = useCallback(() => load(true), [load])
  useWebSocketSubscription('transaction.created', refresh)
  useWebSocketSubscription('transaction.updated', refresh)

  return {
    ...state,
    isRefreshing,
    refresh,
    telemetrySessionKey: telemetrySessionKeyRef.current,
  }
}

export const useConsumerActivityReceiptDownload = (transactionId: string) => {
  const { walletAuthentication } = useWalletAuth()
  const [error, setError] = useState<null | string>(null)
  const [isDownloading, setIsDownloading] = useState(false)

  const download = useCallback(async (language: 'en' | 'pt-BR'): Promise<boolean> => {
    if (!walletAuthentication?.jwtToken || isDownloading) {
      return false
    }
    setError(null)
    setIsDownloading(true)
    try {
      const response = await getConsumerActivityReceipt(transactionId, { lang: language })
      if (response.status !== 200) {
        setError(readFailureReason(response.data, 'Unable to download this receipt right now.'))
        return false
      }
      savePdfReceipt(response.data)
      return true
    }
    catch (downloadError: unknown) {
      setError(
        downloadError instanceof Error
          ? downloadError.message
          : 'Unable to download this receipt right now.',
      )
      return false
    }
    finally {
      setIsDownloading(false)
    }
  }, [
    isDownloading,
    transactionId,
    walletAuthentication?.jwtToken,
  ])

  return {
    download,
    error,
    isDownloading,
  }
}
