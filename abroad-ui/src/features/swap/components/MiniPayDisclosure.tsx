import React from 'react'

import AbroadLogoColored from '../../../assets/Logos/AbroadLogoColored.svg'
import {
  AB_STYLES,
  ABROAD_PRIVACY_URL,
  ABROAD_SUPPORT_URL,
  ABROAD_TERMS_URL,
} from '../../../shared/constants'
import { cn } from '../../../shared/utils'

const MiniPayDisclosure = (): React.JSX.Element => {
  return (
    <section className={cn('w-full max-w-md rounded-2xl border p-4 text-left shadow-sm', AB_STYLES.cardBg)}>
      <div className="flex items-center gap-3">
        <img alt="Abroad" className="h-7 w-auto" src={AbroadLogoColored} />
        <div>
          <div className={cn('text-sm font-semibold', AB_STYLES.text)}>Abroad</div>
          <div className={cn('text-xs', AB_STYLES.textMuted)}>
            Operated by Abroad, not Opera or MiniPay.
          </div>
        </div>
      </div>
      <p className={cn('mt-3 text-sm leading-relaxed', AB_STYLES.textSecondary)}>
        Abroad helps you send supported stablecoins from MiniPay to local payout networks in Brazil and Colombia.
      </p>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <a className={cn('font-medium underline', AB_STYLES.text)} href={ABROAD_SUPPORT_URL} rel="noopener noreferrer" target="_blank">
          Support
        </a>
        <a className={cn('font-medium underline', AB_STYLES.text)} href={ABROAD_TERMS_URL} rel="noopener noreferrer" target="_blank">
          Terms
        </a>
        <a className={cn('font-medium underline', AB_STYLES.text)} href={ABROAD_PRIVACY_URL} rel="noopener noreferrer" target="_blank">
          Privacy
        </a>
      </div>
    </section>
  )
}

export default MiniPayDisclosure
