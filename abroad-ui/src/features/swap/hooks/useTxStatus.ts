import { useCallback, useState } from 'react'

import { swapBus } from '../../../shared/events/swapBus'
import { useEventBus } from '../../../shared/hooks'

export const useTxStatus = () => {
  const [transactionId, setTransactionId] = useState<null | string>(null)

  const onTransactionSigned = useCallback((p: { transactionId: null | string }) => {
    setTransactionId(p.transactionId)
  }, [])
  const onNewTransaction = useCallback(() => {
    setTransactionId(null)
  }, [])
  useEventBus(swapBus, 'swap/transactionSigned', onTransactionSigned)
  useEventBus(swapBus, 'swap/newTransactionRequested', onNewTransaction)

  return { transactionId }
}
