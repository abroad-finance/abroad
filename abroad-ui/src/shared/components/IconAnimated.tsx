import { Player } from '@lordicon/react'
import { useCallback, useEffect, useRef } from 'react'

import AnimatedCheck from '../../assets/animated/AnimatedCheck.json'
import BarChartInReveal from '../../assets/animated/BarChartInReveal.json'
import Coins from '../../assets/animated/Coins.json'
import Denied from '../../assets/animated/Denied.json'
import DocumentSign from '../../assets/animated/DocumentSign.json'
import MagnifyingGlass from '../../assets/animated/MagnifyingGlass.json'
import PlusCircleHoverSwirl from '../../assets/animated/PlusCircleHoverSwirl.json'
import SphereInReveal from '../../assets/animated/SphereInReveal.json'

const Icons = {
  AnimatedCheck, BarChartInReveal, Coins, Denied, DocumentSign, MagnifyingGlass, PlusCircleHoverSwirl, SphereInReveal,
}

type Props = {
  className?: string
  colors?: string
  icon: keyof typeof Icons
  /** When true, animation restarts automatically upon completion while play stays true. */
  loop?: boolean
  /** Callback fired after a non-looping animation completes (or each cycle if you still want it while looping). */
  onComplete?: () => void
  /** When true, the animation plays (or continues looping if loop is also true). */
  play: boolean
  size?: number
}

export const IconAnimated = ({ className, colors, icon, loop, onComplete, play, size }: Props) => {
  const playerRef = useRef<Player>(null)

  const start = useCallback(() => {
    playerRef.current?.playFromBeginning()
  }, [])

  // React to external `play` and icon changes
  useEffect(() => {
    const p = playerRef.current
    if (!p) return
    if (play) start()
    else p.pause()
  }, [
    play,
    icon,
    start,
  ])

  const handleReady = () => {
    if (play) start()
  }

  const handleComplete = () => {
    if (loop && play) start()
    onComplete?.()
  }

  return (
    <div className={className} style={{ display: 'inline-block' }}>
      <Player
        colors={colors}
        icon={Icons[icon]}
        key={icon} // ensure a fresh player when the icon changes
        onComplete={handleComplete}
        onReady={handleReady}
        ref={playerRef}
        size={size}
      />
    </div>
  )
}
