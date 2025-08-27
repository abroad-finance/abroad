import { useTranslate } from '@tolgee/react'
import React from 'react'

import { Button } from '../../shared/components/Button'
import { IconAnimated } from '../../shared/components/IconAnimated'

interface UserVerificationProps {
  onVerify: () => void
}

const UserVerification = ({ onVerify }: UserVerificationProps): React.JSX.Element => {
  const { t } = useTranslate()
  return (
    <div className="flex-1 flex items-center justify-center w-full flex-col">
      <div className="w-[90%] max-w-md min-h-[60vh] bg-[#356E6A]/5 backdrop-blur-xl rounded-4xl p-4 md:p-6 flex flex-col items-center justify-center space-y-1 lg:space-y-4 text-abroad-dark md:text-white">
        <div className="block md:hidden">
          <IconAnimated colors="primary:#26A17B,secondary:#73B9A3" icon="MagnifyingGlass" loop={true} play={true} size={150} />
        </div>
        <div className="hidden md:block">
          <IconAnimated colors="primary:#ffffff,secondary:#ffffff" icon="MagnifyingGlass" loop={true} play={true} size={150} />
        </div>
        <h2 className="text-xl font-semibold text-center mb-4 ">
          {t('user_verification.title', 'Se requiere verificación de usuario')}
        </h2>
        <p className="text-center mb-6">
          {t('user_verification.subtitle', 'Verifique su cuenta para acceder a todas las funciones.')}
        </p>
      </div>
      <Button
        className="mt-4 w-[90%] max-w-md py-4 cursor-pointer"
        onClick={onVerify}
      >
        {t('user_verification.cta', 'Verificar Ahora')}
      </Button>
    </div>
  )
}

export default UserVerification
