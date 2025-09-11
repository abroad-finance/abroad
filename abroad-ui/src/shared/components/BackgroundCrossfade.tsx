import { motion } from 'framer-motion'
import React from 'react'

type Props = {
  /** CSS background-attachment value; default 'fixed' */
  backgroundAttachment?: 'fixed' | 'local' | 'scroll'
  /** Additional classes for the layers */
  className?: string
  /** Fade duration in seconds; default 0.35 */
  durationSec?: number
  imageUrl: string
  /** Absolute positioning class override; default 'absolute inset-0' */
  positionClass?: string
  /** Tailwind classes controlling visibility like 'hidden md:block'; applied to both layers */
  visibilityClass?: string
  /** z-index class for layers; default 'z-0' */
  zIndexClass?: string
}

/**
 * Renders a crossfading background with a persistent base layer and a fading overlay.
 * Preloads the next image before animating to avoid white flashes.
 */
const BackgroundCrossfade: React.FC<Props> = ({
  backgroundAttachment = 'fixed',
  className = '',
  durationSec = 0.35,
  imageUrl,
  positionClass = 'absolute inset-0',
  visibilityClass = '',
  zIndexClass = 'z-0',
}) => {
  const [baseBgUrl, setBaseBgUrl] = React.useState(imageUrl)
  const [overlayBgUrl, setOverlayBgUrl] = React.useState<null | string>(null)

  React.useEffect(() => {
    if (imageUrl === baseBgUrl) return
    let canceled = false
    const img = new Image()
    img.src = imageUrl
    const startOverlay = () => {
      if (!canceled) setOverlayBgUrl(imageUrl)
    }
    if (img.complete) {
      startOverlay()
    }
    else {
      img.onload = startOverlay
      img.onerror = () => {
        if (!canceled) {
          setBaseBgUrl(imageUrl)
          setOverlayBgUrl(null)
        }
      }
    }
    return () => {
      canceled = true
    }
  }, [imageUrl, baseBgUrl])

  const handleOverlayComplete = React.useCallback(() => {
    if (overlayBgUrl) {
      setBaseBgUrl(overlayBgUrl)
      setOverlayBgUrl(null)
    }
  }, [overlayBgUrl])

  const layerClasses = `${positionClass} ${zIndexClass} ${visibilityClass} ${className} bg-cover bg-center bg-no-repeat`

  return (
    <>
      <div
        className={layerClasses}
        style={{
          backgroundAttachment,
          backgroundImage: `url(${baseBgUrl})`,
        }}
      />
      {overlayBgUrl && (
        <motion.div
          animate={{ opacity: 1 }}
          className={layerClasses}
          initial={{ opacity: 0 }}
          key={overlayBgUrl}
          onAnimationComplete={handleOverlayComplete}
          style={{
            backgroundAttachment,
            backgroundImage: `url(${overlayBgUrl})`,
            pointerEvents: 'none' as const,
          }}
          transition={{
            duration: durationSec,
            ease: 'easeOut',
          }}
        />
      )}
    </>
  )
}

export default BackgroundCrossfade
