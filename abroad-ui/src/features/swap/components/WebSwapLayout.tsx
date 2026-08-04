import { useTranslate } from '@tolgee/react'
import React, { useMemo } from 'react'

import { _36EnumsTargetCurrency as TargetCurrency } from '../../../api'
import { cn } from '../../../shared/utils'
import { SwapView } from '../types'

export interface WebSwapLayoutProps {
  disclosure?: null | React.JSX.Element
  showJourneyProgress?: boolean
  targetCurrency: (typeof TargetCurrency)[keyof typeof TargetCurrency]
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

const WebSwapLayout: React.FC<WebSwapLayoutProps & WebSwapLayoutSlots> = ({
  disclosure = null,
  showJourneyProgress = false,
  slots,
  targetCurrency,
  view,
}) => {
  const { t } = useTranslate()
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
  const journeyStep = useMemo(() => {
    switch (view) {
      case 'confirm-qr':
        return { label: t('journey.progress.review', 'Review payment'), value: 3 }
      case 'home':
        return {
          label: targetCurrency === TargetCurrency.BRL
            ? t('journey.progress.setup_pix', 'Destination and source · Brazil · Pix')
            : t('journey.progress.setup_breb', 'Destination and source · Colombia · BRE-B'),
          value: 1,
        }
      case 'kyc-needed':
        return null
      case 'swap':
        return { label: t('journey.progress.details', 'Payment details'), value: 2 }
      case 'txStatus':
        return { label: t('journey.progress.receipt', 'Track and receipt'), value: 5 }
      case 'wait-sign':
        return { label: t('journey.progress.authorize', 'Authorize in wallet'), value: 4 }
    }
  }, [
    t,
    targetCurrency,
    view,
  ])

  return (
    <div
      className={cn(
        'w-full min-h-0 flex-1 flex flex-col items-center overflow-x-hidden overflow-y-auto px-3 py-[clamp(0.5rem,2vh,1.5rem)] md:px-4',
        isMainFlow ? 'hero-gradient justify-start' : 'justify-center',
      )}
    >
      <div className={cn('w-full', isMainFlow ? 'max-w-[576px]' : 'max-w-md')}>
        {showJourneyProgress && journeyStep && (
          <section aria-label={t('journey.progress.label', 'Payment progress')} className="mb-3 rounded-2xl border border-[var(--ab-border)] bg-[var(--ab-card)] px-4 py-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-3 text-xs font-semibold">
              <span className="text-[var(--ab-text)]">{journeyStep.label}</span>
              <span className="shrink-0 text-[var(--ab-text-muted)]">
                {t('journey.progress.step', 'Step {current} of {total}', {
                  current: journeyStep.value,
                  total: 5,
                })}
              </span>
            </div>
            <progress
              aria-label={t('journey.progress.value', '{label}: step {current} of {total}', {
                current: journeyStep.value,
                label: journeyStep.label,
                total: 5,
              })}
              className="h-1.5 w-full overflow-hidden rounded-full accent-[var(--ab-green)]"
              max={5}
              value={journeyStep.value}
            />
          </section>
        )}
        {renderSwap}
        {disclosure}
      </div>
    </div>
  )
}

export default WebSwapLayout
