// WebSwapLayout.tsx
import { useTolgee, useTranslate } from '@tolgee/react'
import React, { useMemo } from 'react'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'
import { BRAND_TITLE_STYLE } from '../../../shared/constants'
import { getSwapPageTitleDefault } from '../constants/swapPageTitles'
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
  const { t } = useTranslate()
  const tolgee = useTolgee()
  const lang = tolgee.getLanguage()

  const pageTitle
    = targetCurrency === TargetCurrency.BRL
      ? t('swap.page_title_brl', getSwapPageTitleDefault(lang, 'brl'))
      : t('swap.page_title_cop', getSwapPageTitleDefault(lang, 'cop'))

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
    <div
      className="w-full overflow-x-hidden overflow-y-auto md:overflow-hidden min-h-0 flex-1 flex flex-col md:items-center md:justify-center md:px-4 md:py-8"
    >
      {/* ---------- Mobile (<= md) ---------- */}
      <div className="md:hidden flex flex-col w-full">
        <div
          className="min-h-[600px] h-[calc(100vh-80px)] flex flex-col items-center justify-center px-4 py-6 gap-6"
          style={{ background: 'linear-gradient(135deg, var(--ab-bg), var(--ab-bg-end))' }}
        >
          <h1
            className="text-3xl font-black text-center w-full"
            style={BRAND_TITLE_STYLE}
          >
            {pageTitle}
          </h1>
          <div className="w-full max-w-md">
            {renderSwap}
          </div>
        </div>
      </div>

      {/* ---------- Desktop (>= md): single section, centered, 30% larger ---------- */}
      <div className="hidden md:flex flex-1 min-h-0 w-full min-w-[552px] max-w-[552px] flex-col items-center justify-center">
        <div
          className="w-full max-w-[424px] flex flex-col items-center gap-6"
          style={{
            transform: 'scale(1.3)',
            transformOrigin: 'center center',
          }}
        >
          <h1
            className="text-3xl font-black text-center w-full"
            style={BRAND_TITLE_STYLE}
          >
            {pageTitle}
          </h1>
          {renderSwap}
        </div>
      </div>
    </div>
  )
}

export default WebSwapLayout
