import AnimatedCheck from '../assets/animated/AnimatedCheck.json'
import Coins from '../assets/animated/Coins.json'
import Denied from '../assets/animated/Denied.json'
import PlusCircleHoverSwirl from '../assets/animated/PlusCircleHoverSwirl.json'
import { useRef, useEffect } from 'react'
import { Player } from '@lordicon/react'


const Icons = {
    AnimatedCheck, Coins, Denied, PlusCircleHoverSwirl
}

type Props = {
    icon: keyof typeof Icons
    className?: string
    colors?: string
    size?: number
    trigger?: "hover" | "click" | "loop" | "once"
}

export const IconAnimated = ({ icon, colors, size, trigger }: Props) => {
    const playerRef = useRef<Player>(null);

    useEffect(() => {
        // Auto-start animations based on icon type and trigger
        if (trigger === 'loop' || trigger === 'once') {
            // Start animation immediately when component mounts
            playerRef.current?.playFromBeginning();
        }
    }, [trigger]);

    const handleMouseEnter = () => {
        if (trigger === 'hover') {
            playerRef.current?.playFromBeginning();
        }
    };

    const handleClick = () => {
        if (trigger === 'click') {
            playerRef.current?.playFromBeginning();
        }
    };

    const handleComplete = () => {
        // Only loop for 'loop' trigger (Coins icon)
        if (trigger === 'loop') {
            playerRef.current?.playFromBeginning();
        }
        // For 'once' trigger (AnimatedCheck, Denied), animation plays once and stops
    };

    return (
        <div 
            onMouseEnter={handleMouseEnter}
            onClick={handleClick}
            style={{ display: 'inline-block' }}
        >
            <Player 
                colors={colors}
                ref={playerRef}
                icon={Icons[icon]}
                size={size}
                onComplete={handleComplete}
            />
        </div>
    );
}