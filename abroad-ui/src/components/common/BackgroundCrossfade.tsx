import React from 'react';
import { motion } from 'framer-motion';

type Props = {
  imageUrl: string;
  /** Tailwind classes controlling visibility like 'hidden md:block'; applied to both layers */
  visibilityClass?: string;
  /** Absolute positioning class override; default 'absolute inset-0' */
  positionClass?: string;
  /** z-index class for layers; default 'z-0' */
  zIndexClass?: string;
  /** CSS background-attachment value; default 'fixed' */
  backgroundAttachment?: 'scroll' | 'fixed' | 'local';
  /** Additional classes for the layers */
  className?: string;
  /** Fade duration in seconds; default 0.35 */
  durationSec?: number;
};

/**
 * Renders a crossfading background with a persistent base layer and a fading overlay.
 * Preloads the next image before animating to avoid white flashes.
 */
const BackgroundCrossfade: React.FC<Props> = ({
  imageUrl,
  visibilityClass = '',
  positionClass = 'absolute inset-0',
  zIndexClass = 'z-0',
  backgroundAttachment = 'fixed',
  className = '',
  durationSec = 0.35,
}) => {
  const [baseBgUrl, setBaseBgUrl] = React.useState(imageUrl);
  const [overlayBgUrl, setOverlayBgUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (imageUrl === baseBgUrl) return;
    let canceled = false;
    const img = new Image();
    img.src = imageUrl;
    const startOverlay = () => {
      if (!canceled) setOverlayBgUrl(imageUrl);
    };
    if (img.complete) {
      startOverlay();
    } else {
      img.onload = startOverlay;
      img.onerror = () => {
        if (!canceled) {
          setBaseBgUrl(imageUrl);
          setOverlayBgUrl(null);
        }
      };
    }
    return () => {
      canceled = true;
    };
  }, [imageUrl, baseBgUrl]);

  const handleOverlayComplete = React.useCallback(() => {
    if (overlayBgUrl) {
      setBaseBgUrl(overlayBgUrl);
      setOverlayBgUrl(null);
    }
  }, [overlayBgUrl]);

  const layerClasses = `${positionClass} ${zIndexClass} ${visibilityClass} ${className} bg-cover bg-center bg-no-repeat`;

  return (
    <>
      <div
        className={layerClasses}
        style={{ backgroundImage: `url(${baseBgUrl})`, backgroundAttachment }}
      />
      {overlayBgUrl && (
        <motion.div
          key={overlayBgUrl}
          className={layerClasses}
          style={{ backgroundImage: `url(${overlayBgUrl})`, backgroundAttachment, pointerEvents: 'none' as const }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: durationSec, ease: 'easeOut' }}
          onAnimationComplete={handleOverlayComplete}
        />
      )}
    </>
  );
};

export default BackgroundCrossfade;
