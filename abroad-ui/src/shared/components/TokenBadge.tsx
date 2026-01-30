import React from 'react'

interface TokenBadgeProps {
    alt?: string // alt text for icon
    iconSrc: string // token icon URL
    symbol: string // token symbol text
    transparent?: boolean
    suffix?: React.ReactNode
}

export const TokenBadge: React.FC<TokenBadgeProps> = ({ alt, iconSrc, symbol, transparent, suffix }) => (
    <div className={`${transparent ? 'p-0' : 'bg-white/60 backdrop-blur-xl px-4 py-2'} rounded-4xl flex items-center justify-center text-abroad-dark`}>
        <img
            alt={alt || symbol}
            className="w-8 h-8 mr-2"
            src={iconSrc}
        />
        <span className={suffix ? 'mr-0.5' : ''}>{symbol}</span>
        {suffix}
    </div>
)
