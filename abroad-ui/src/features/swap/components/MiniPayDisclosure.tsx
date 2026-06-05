import { useTranslate } from '@tolgee/react'
import React from 'react'

import AbroadLogoColored from '../../../assets/Logos/AbroadLogoColored.svg'
import AbroadLogoWhite from '../../../assets/Logos/AbroadLogoWhite.svg'
import {
  AB_STYLES,
  ABROAD_PRIVACY_URL,
  ABROAD_SUPPORT_URL,
  ABROAD_TERMS_URL,
} from '../../../shared/constants'
import { cn } from '../../../shared/utils'

interface MiniPayDisclosureProps {
  isDark?: boolean
}

const MiniPayDisclosure = ({ isDark = false }: MiniPayDisclosureProps): React.JSX.Element => {
  const { t } = useTranslate()

  return (
    <section className={cn('mt-5 w-full max-w-md rounded-2xl border px-4 py-3 text-left shadow-sm md:mt-6', AB_STYLES.cardBg)}>
      <div className="flex items-center gap-2.5">
        <img alt="Abroad" className="h-6 w-auto shrink-0" src={isDark ? AbroadLogoWhite : AbroadLogoColored} />
        <div className="min-w-0">
          <div className={cn('text-sm font-semibold leading-tight', AB_STYLES.text)}>{t('minipay.app_name', 'Abroad')}</div>
          <div className={cn('text-xs leading-tight', AB_STYLES.textSecondary)}>
            {t('minipay.operated_by', 'Operated by Abroad, not Opera or MiniPay.')}
          </div>
        </div>
      </div>
      <p className={cn('mt-2 text-xs leading-relaxed', AB_STYLES.textSecondary)}>
        {t('minipay.description', 'Abroad helps you send supported stablecoins from MiniPay to local payout networks in Brazil and Colombia.')}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-4 text-xs">
        <a className={cn('font-medium underline', AB_STYLES.text)} href={ABROAD_SUPPORT_URL} rel="noopener noreferrer" target="_blank">
          {t('minipay.support', 'Support')}
        </a>
        <a className={cn('font-medium underline', AB_STYLES.text)} href={ABROAD_TERMS_URL} rel="noopener noreferrer" target="_blank">
          {t('minipay.terms', 'Terms')}
        </a>
        <a className={cn('font-medium underline', AB_STYLES.text)} href={ABROAD_PRIVACY_URL} rel="noopener noreferrer" target="_blank">
          {t('minipay.privacy', 'Privacy')}
        </a>
      </div>
    </section>
  )
}

export default MiniPayDisclosure
