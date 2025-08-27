import { Player } from '@lordicon/react'
import { useEffect, useRef } from 'react'

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
  const lastPlayRef = useRef(false)

  // React to external play flag changes (controlled behavior)
  useEffect(() => {
    if (play && !lastPlayRef.current) {
      playerRef.current?.playFromBeginning()
    }
    else if (!play && lastPlayRef.current) {
      // Pause when play turns false
      playerRef.current?.pause()
    }
    lastPlayRef.current = play
  }, [play])

  const handleComplete = () => {
    if (loop && play) {
      playerRef.current?.playFromBeginning()
    }
    onComplete?.()
  }

  return (
    <div className={className} style={{ display: 'inline-block' }}>
      <Player
        colors={colors}
        icon={Icons[icon]}
        onComplete={handleComplete}
        ref={playerRef}
        size={size}
      />
    </div>
  )
}
