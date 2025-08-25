import { Player } from '@lordicon/react'
import { useEffect, useRef } from 'react'

import AnimatedCheck from '../assets/animated/AnimatedCheck.json'
import BarChartInReveal from '../assets/animated/BarChartInReveal.json'
import Coins from '../assets/animated/Coins.json'
import Denied from '../assets/animated/Denied.json'
import PlusCircleHoverSwirl from '../assets/animated/PlusCircleHoverSwirl.json'
import SphereInReveal from '../assets/animated/SphereInReveal.json'

const Icons = {
  AnimatedCheck, BarChartInReveal, Coins, Denied, PlusCircleHoverSwirl, SphereInReveal,
}

type Props = {
  className?: string
  colors?: string
  icon: keyof typeof Icons
  size?: number
  trigger?: 'click' | 'hover' | 'loop' | 'once'
}

export const IconAnimated = ({ colors, icon, size, trigger }: Props) => {
  const playerRef = useRef<Player>(null)

  useEffect(() => {
    // Auto-start animations based on icon type and trigger
    const startAnimation = () => {
      if (trigger === 'loop' || trigger === 'once') {
        // Start animation immediately when component mounts
        playerRef.current?.playFromBeginning()
      }
      else if (!trigger && icon === 'SphereInReveal') {
        // SphereInReveal is an "in-reveal" animation that should auto-play
        playerRef.current?.playFromBeginning()
      }
    }

    // Small delay to ensure Player is initialized
    const timer = setTimeout(startAnimation, 100)
    return () => clearTimeout(timer)
  }, [trigger, icon])

  const handleMouseEnter = () => {
    if (trigger === 'hover') {
      playerRef.current?.playFromBeginning()
    }
  }

  const handleClick = () => {
    if (trigger === 'click') {
      playerRef.current?.playFromBeginning()
    }
  }

  const handleComplete = () => {
    // Only loop for 'loop' trigger (Coins icon)
    if (trigger === 'loop') {
      playerRef.current?.playFromBeginning()
    }
    // For 'once' trigger (AnimatedCheck, Denied), animation plays once and stops
  }

  return (
    <div
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      style={{ display: 'inline-block' }}
    >
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
