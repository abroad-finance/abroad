// WebSwapLayout.tsx
import { useTolgee, useTranslate } from '@tolgee/react'
import React, { useMemo } from 'react'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'
import { BRAND_TITLE_CLASS } from '../../../shared/constants'
import { cn } from '../../../shared/utils'
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
    home: React.JSX.Element
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

  const showPageTitle = view !== 'home' && view !== 'swap'

  const isMainFlow = view === 'home' || view === 'swap' || view === 'bankDetails'

  return (
    <div
      className={cn(
        'w-full min-h-0 flex-1 flex flex-col items-center overflow-x-hidden overflow-y-auto px-4 py-6 md:px-4 md:py-8',
        isMainFlow ? 'hero-gradient justify-start' : 'justify-center'
      )}
    >
      {showPageTitle && (
        <h1 className={cn('text-3xl font-black text-center w-full mb-6', BRAND_TITLE_CLASS)}>
          {pageTitle}
        </h1>
      )}
      <div className={cn('w-full', isMainFlow ? 'max-w-[576px]' : 'max-w-md')}>
        {renderSwap}
      </div>
    </div>
  )
}

export default WebSwapLayout
