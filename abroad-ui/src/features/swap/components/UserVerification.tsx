import { useTolgee, useTranslate } from '@tolgee/react'
import { X } from 'lucide-react'
import Persona from 'persona'
import React, { useCallback } from 'react'

import { useNotices } from '../../../contexts/NoticeContext'
import { useWebSocketSubscription } from '../../../contexts/WebSocketContext'
import { Button } from '../../../shared/components/Button'
import { IconAnimated } from '../../../shared/components/IconAnimated'
import { useWalletAuth } from '../../../shared/hooks/useWalletAuth'

interface UserVerificationProps {
  onApproved?: () => void
  onClose: () => void
}

const UserVerification = ({ onApproved, onClose }: UserVerificationProps): React.JSX.Element => {
  const { t } = useTranslate()
  const { addNotice } = useNotices()
  const { kycUrl, setKycUrl } = useWalletAuth()
  const { getLanguage } = useTolgee()
  const [loading, setLoading] = React.useState(false)

  const handleKycRedirect = useCallback(() => {
    if (kycUrl) {
      setLoading(true)
      const inquiryId = kycUrl.split('inquiry-id=')[1].split('&')[0]

      const clientPersona = new Persona.Client({
        environmentId: import.meta.env.VITE_PERSONA_ENV,
        inquiryId,
        language: getLanguage(),
        onComplete: ({ status }) => {
          if (status.toLowerCase() === 'approved') {
            setKycUrl(null)
            onApproved?.()
          }
        },
        onReady: () => {
          clientPersona.open()
          setLoading(false)
        },
      })
    }
    else {
      addNotice({
        description: t('user_verification.missing_url', 'No encontramos el enlace de verificación.'),
        kind: 'error',
        message: t('user_verification.missing_url_title', 'No se encontró el enlace de KYC'),
      })
    }
  }, [
    addNotice,
    getLanguage,
    kycUrl,
    onApproved,
    setKycUrl,
    t,
  ])

  useWebSocketSubscription('kyc.updated', (payload) => {
    if (payload?.newStatus === 'APPROVED') {
      setKycUrl(null)
      onApproved?.()
    }
  }, [onApproved, setKycUrl])
  return (
    <div className="flex-1 flex items-center justify-center w-full flex-col">
      <div className="w-[98%] max-w-md min-h-[60vh] bg-[#356E6A]/5 backdrop-blur-xl rounded-4xl p-4 md:p-6 flex flex-col items-center justify-center space-y-1 lg:space-y-4 text-abroad-dark md:text-white">
        <button
          aria-label="Close"
          className="fixed top-4 right-4 z-20 rounded-full bg-white/90 p-2 shadow-md md:top-6 md:right-6"
          onClick={onClose}
        >
          <X className="w-5 h-5 text-abroad-dark" />
        </button>
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
        loading={loading}
        onClick={handleKycRedirect}
      >
        {t('user_verification.cta', 'Verificar Ahora')}
      </Button>
    </div>
  )
}

export default UserVerification
