// WebSwapLayout.tsx
import React, { useMemo } from 'react'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'
import { cn } from '../../../shared/utils'
import { SwapView } from '../types'

export interface WebSwapLayoutProps {
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  view: SwapView
}

type WebSwapLayoutSlots = {
  slots: {
    bankDetails: React.JSX.Element
    confirmQr: React.JSX.Element
    home: React.JSX.Element
    kycNeeded: React.JSX.Element
    swap: React.JSX.Element
    txStatus: React.JSX.Element
    waitSign: React.JSX.Element
  }
}

const WebSwapLayout: React.FC<WebSwapLayoutProps & WebSwapLayoutSlots> = ({ slots, targetCurrency, view }) => {
  const renderSwap = useMemo(() => {
    switch (view) {
      case 'bankDetails':
        return slots.bankDetails
      case 'confirm-qr':
        return slots.confirmQr
      case 'home':
        return slots.home
      case 'kyc-needed':
        return slots.kycNeeded
      case 'swap':
        return slots.swap
      case 'txStatus':
        return slots.txStatus
      case 'wait-sign':
        return slots.waitSign
    }
  }, [
    slots.bankDetails,
    slots.confirmQr,
    slots.home,
    slots.kycNeeded,
    slots.swap,
    slots.txStatus,
    slots.waitSign,
    view,
  ])

  const isMainFlow = view === 'home' || view === 'swap' || view === 'bankDetails'

  return (
    <div
      className={cn(
        'w-full min-h-0 flex-1 flex flex-col items-center overflow-x-hidden overflow-y-auto px-4 py-6 md:px-4 md:py-8',
        isMainFlow ? 'hero-gradient justify-start' : 'justify-center'
      )}
    >
      <div className={cn('w-full', isMainFlow ? 'max-w-[576px]' : 'max-w-md')}>
        {renderSwap}
      </div>
    </div>
  )
}

export default WebSwapLayout
