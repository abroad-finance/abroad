// WebSwapLayout.tsx
import React, { useMemo } from 'react'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'
import AnimatedHeroText from '../../../shared/components/AnimatedHeroText'
import ImageAttribution from '../../../shared/components/ImageAttribution'
import { ASSET_URLS } from '../../../shared/constants'
import { SwapView } from '../types'

export interface WebSwapLayoutProps {
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
  view: SwapView
}

type WebSwapLayoutSlots = {
  slots: {
    bankDetails: React.JSX.Element
    confirmQr: React.JSX.Element
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
    slots.kycNeeded,
    slots.swap,
    slots.txStatus,
    slots.waitSign,
    view,
  ])

  return (
    <div className="w-full">
      {/* ---------- Mobile (<= md) ---------- */}
      <div className="md:hidden flex flex-col w-full">
        {/* Swap Interface */}
        <div className="h-[calc(100vh-80px)] bg-green-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md">
            {renderSwap}
          </div>
        </div>
      </div>

      {/* ---------- Desktop (>= md) ---------- */}
      <div className="hidden md:flex flex-row w-full h-full">
        {/* Left Column - Marketing */}
        <div className="w-1/2 flex flex-col justify-center relative px-4 py-10 sm:px-6 lg:px-8">
          <div className="text-6xl max-w-xl">
            <AnimatedHeroText currency={targetCurrency} />
          </div>
          <ImageAttribution
            className="absolute bottom-5 left-5"
            currency={String(targetCurrency)}
          />
        </div>

        {/* Right Column - Swap Interface */}
        <div className="w-1/2 flex flex-col justify-center items-center p-10 relative">
          <div className="w-full max-w-md">
            {renderSwap}
          </div>
          <div className="absolute bottom-5 right-5 flex items-center gap-3 text-white font-sans text-base">
            <span>powered by</span>
            <img alt="Stellar" className="h-9 w-auto" src={ASSET_URLS.STELLAR_LOGO} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default WebSwapLayout
