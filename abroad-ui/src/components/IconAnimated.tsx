import AnimatedCheck from '../assets/animated/AnimatedCheck.json'
import Coins from '../assets/animated/Coins.json'
import Denied from '../assets/animated/Denied.json'
import { useRef, useEffect } from 'react'
import { Player } from '@lordicon/react'

const Icons = {
    AnimatedCheck, Coins, Denied
}

type Props = {
    icon: keyof typeof Icons
    className?: string
    colors?: string
    size?: number
    timer?: number
    loop?: boolean
}

export const IconAnimated = ({ icon, colors, size, timer, loop }: Props) => {
    const playerRef = useRef<Player>(null);

    useEffect(() => {
        if (!loop) return  /* only start timer if looping */;
        const timerId = setTimeout(() => {
            playerRef.current?.playFromBeginning();
        }, timer);

        return () => clearTimeout(timerId);  /* clear timeout on unmount */
    }, [loop, timer]);

    return (
        <Player 
            colors={colors}
            ref={playerRef}
            icon={Icons[icon]}
            size={size}
            {...(loop && { onComplete: () => playerRef.current?.playFromBeginning() })}  /* loop on complete */
        />
    );
}