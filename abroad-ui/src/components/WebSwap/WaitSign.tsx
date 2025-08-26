import { useTranslate } from '@tolgee/react'
import React from 'react'

interface WaitSignProps {
  // kept minimal — no interactions required
  textColor?: string
}

const WaitSign = ({ textColor = '#FFFFFF' }: WaitSignProps): React.JSX.Element => {
  const { t } = useTranslate()
  return (
    <div className="flex-1 flex items-center justify-center w-full flex-col">
      <div className="w-[90%] max-w-md min-h-[60vh] bg-[#356E6A]/5 backdrop-blur-xl rounded-4xl p-4 md:p-6 flex flex-col items-center justify-center space-y-1 lg:space-y-4">
        <h2 className="text-xl font-semibold text-center mb-4" style={{ color: textColor }}>
          {t('wait_sign.wait_sign', 'Esperando firma en wallet...')}
        </h2>
        <p className="text-center mb-6" style={{ color: textColor }}>
          {t('wait_sign.wait_message', 'Por favor espera mientras se firma la transacción en tu billetera.')}
        </p>
      </div>
    </div>
  )
}

export default WaitSign
