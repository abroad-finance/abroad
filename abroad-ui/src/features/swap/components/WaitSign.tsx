import { useTranslate } from '@tolgee/react'
import React from 'react'

import { IconAnimated } from '../../../shared/components/IconAnimated'

const WaitSign = (): React.JSX.Element => {
  const { t } = useTranslate()
  return (
    <div className="flex-1 flex items-center justify-center w-full flex-col">
      <div className="w-[98%] max-w-md min-h-[60vh] bg-[#356E6A]/5 backdrop-blur-xl rounded-4xl p-4 md:p-6 flex flex-col items-center justify-center space-y-1 lg:space-y-4 text-abroad-dark md:text-white">
        <div className="block md:hidden">
          <IconAnimated colors="primary:#356E6A,secondary:#26A17B" icon="DocumentSign" loop={true} play={true} size={150} />
        </div>
        <div className="hidden md:block">
          <IconAnimated colors="primary:#ffffff,secondary:#ffffff" icon="DocumentSign" loop={true} play={true} size={150} />
        </div>
        <h2 className="text-xl font-semibold text-center mb-4">
          {t('wait_sign.wait_sign', 'Esperando firma en wallet...')}
        </h2>
        <p className="text-center mb-6">
          {t('wait_sign.wait_message', 'Por favor espera mientras se firma la transacción en tu billetera.')}
        </p>
      </div>
    </div>
  )
}

export default WaitSign
