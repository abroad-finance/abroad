import { useTranslate } from '@tolgee/react'
import React from 'react'

import { IconAnimated } from '../../../shared/components/IconAnimated'

interface WaitSignProps {
  isDark?: boolean
}

const WaitSign = ({ isDark = false }: WaitSignProps): React.JSX.Element => {
  const { t } = useTranslate()
  return (
    <div className="flex-1 flex items-center justify-center w-full flex-col">
      <div className="w-full max-w-md py-[clamp(2.5rem,8vh,5rem)] bg-[var(--ab-card)] border border-[var(--ab-border)] backdrop-blur-xl rounded-2xl p-4 md:p-6 flex flex-col items-center justify-center space-y-1 lg:space-y-4 text-[var(--ab-text)]">
        <IconAnimated
          colors={isDark ? 'primary:#e0f0ec,secondary:#73B9A3' : 'primary:#356E6A,secondary:#26A17B'}
          icon="DocumentSign"
          loop={true}
          play={true}
          size={150}
        />
        <h2 className="text-xl font-semibold text-center mb-4">
          {t('wait_sign.wait_sign', 'Confirm your payment in your wallet')}
        </h2>
        <p className="text-center mb-6 text-[var(--ab-text-secondary)]">
          {t('wait_sign.wait_message', 'Your wallet will ask you to confirm the transaction.')}
        </p>
      </div>
    </div>
  )
}

export default WaitSign
