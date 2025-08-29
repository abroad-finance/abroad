import { useCallback, useState } from 'react'

import { swapBus } from '../../../shared/events/swapBus'
import { useEventBus } from '../../../shared/hooks'
import { SwapView } from '../types'

export const useSwapView = () => {
  const [view, setView] = useState<SwapView>('swap')

  const toSwap = useCallback(() => setView('swap'), [])
  const toBank = useCallback(() => setView('bankDetails'), [])
  const toKyc = useCallback(() => setView('kyc-needed'), [])
  const toWaitSign = useCallback(() => setView('wait-sign'), [])
  const toTxStatus = useCallback(() => setView('txStatus'), [])

  useEventBus(swapBus, 'swap/backToSwapRequested', toSwap)
  useEventBus(swapBus, 'swap/newTransactionRequested', toSwap)
  useEventBus(swapBus, 'swap/continueRequested', toBank)
  useEventBus(swapBus, 'swap/kycRequired', toKyc)
  useEventBus(swapBus, 'swap/walletSigningStarted', toWaitSign)
  useEventBus(swapBus, 'swap/transactionSigned', toTxStatus)
  useEventBus(swapBus, 'swap/amountsRestoredFromPending', toBank)

  return { view }
}
