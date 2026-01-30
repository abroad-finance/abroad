import React from 'react'

interface TokenBadgeProps {
  alt?: string // alt text for icon
  iconSrc: string // token icon URL
  symbol: string // token symbol text
  transparent?: boolean
}

export const TokenBadge: React.FC<TokenBadgeProps> = ({ alt, iconSrc, symbol, transparent }) => (
  <div className={`${transparent ? '' : 'bg-white/60 backdrop-blur-xl'} rounded-4xl px-4 py-2 flex items-center justify-center text-abroad-dark`}>
    <img
      alt={alt || symbol}
      className="w-8 h-8 mr-2"
      src={iconSrc}
    />
    <span>{symbol}</span>
  </div>
)
