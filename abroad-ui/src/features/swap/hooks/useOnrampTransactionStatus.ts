import {
  useCallback, useEffect, useRef, useState,
} from 'react'

import type { TransactionStatus } from '../../../api'
import type { OnrampTransactionStatus } from '../shared/onrampSettlement'

import { getTransactionStatus } from '../../../api'
import { useWebSocket, useWebSocketSubscription } from '../../../contexts/WebSocketContext'
import { toSettlementStage } from '../shared/onrampSettlement'

/**
 * Live status for one onramp transaction.
 *
 * The websocket is the fast path, but it cannot be the only path: notifications
 * are at-least-once, can arrive out of order, and are delayed by an outbox poll,
 * so a customer who lost the socket while paying would otherwise watch a screen
 * that never moves. Every connect — including every reconnect — reconciles
 * against REST, and socket events refine that.
 */
export const useOnrampTransactionStatus = (
  transactionId: null | string,
): OnrampTransactionStatus => {
  const { connected } = useWebSocket()
  const [status, setStatus] = useState<null | TransactionStatus>(null)
  const [onChainTxHash, setOnChainTxHash] = useState<null | string>(null)
  const transactionIdRef = useRef(transactionId)
  transactionIdRef.current = transactionId

  useEffect(() => {
    setStatus(null)
    setOnChainTxHash(null)
  }, [transactionId])

  const reconcile = useCallback(async () => {
    const id = transactionIdRef.current
    if (!id) return
    try {
      const response = await getTransactionStatus(id)
      // A response for a transaction the screen has already moved on from must
      // not overwrite the current one.
      if (transactionIdRef.current !== id || response.status !== 200) return
      setStatus(response.data.status)
      setOnChainTxHash(response.data.on_chain_tx_hash)
    }
    catch {
      // A failed reconcile is not worth surfacing: the socket is still live and
      // the next event or reconnect will correct the screen.
    }
  }, [])

  // Reconcile on mount and on every (re)connect, so a dropped socket self-heals.
  useEffect(() => {
    void reconcile()
  }, [
    reconcile,
    transactionId,
    connected,
  ])

  const applyEvent = useCallback((payload: { id?: string, status?: TransactionStatus }) => {
    if (!payload?.id || payload.id !== transactionIdRef.current || !payload.status) return
    setStatus(payload.status)
    // The event carries no chain hash; a completed delivery re-reads it.
    if (payload.status === 'PAYMENT_COMPLETED') void reconcile()
  }, [reconcile])

  useWebSocketSubscription('transaction.updated', applyEvent)
  useWebSocketSubscription('transaction.created', applyEvent)

  return { onChainTxHash, stage: toSettlementStage(status), status }
}
