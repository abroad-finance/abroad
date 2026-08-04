import React, { useMemo } from 'react'

import { cn } from '../../../shared/utils'
import { SwapView } from '../types'

export interface WebSwapLayoutProps {
  disclosure?: null | React.JSX.Element
  view: SwapView
}

type WebSwapLayoutSlots = {
  slots: {
    confirmQr: React.JSX.Element
    home: React.JSX.Element
    kycNeeded: React.JSX.Element
    swap: React.JSX.Element
    txStatus: React.JSX.Element
    waitSign: React.JSX.Element
  }
}

const WebSwapLayout: React.FC<WebSwapLayoutProps & WebSwapLayoutSlots> = ({ disclosure = null, slots, view }) => {
  const renderSwap = useMemo(() => {
    switch (view) {
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
    slots.confirmQr,
    slots.home,
    slots.kycNeeded,
    slots.swap,
    slots.txStatus,
    slots.waitSign,
    view,
  ])

  const isMainFlow = view === 'home' || view === 'swap'

  return (
    <div
      className={cn(
        'w-full min-h-0 flex-1 flex flex-col items-center overflow-x-hidden overflow-y-auto px-3 py-[clamp(0.5rem,2vh,1.5rem)] md:px-4',
        isMainFlow ? 'hero-gradient justify-start' : 'justify-center',
      )}
    >
      <div className={cn('w-full', isMainFlow ? 'max-w-[576px]' : 'max-w-md')}>
        {renderSwap}
        {disclosure}
      </div>
    </div>
  )
}

export default WebSwapLayout
