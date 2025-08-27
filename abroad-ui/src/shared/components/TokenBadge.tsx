import React from 'react'

interface TokenBadgeProps {
  alt?: string // alt text for icon
  iconSrc: string // token icon URL
  symbol: string // token symbol text
}

export const TokenBadge: React.FC<TokenBadgeProps> = ({ alt, iconSrc, symbol }) => (
  <div className="bg-white/60 backdrop-blur-xl rounded-4xl px-4 py-2 flex items-center justify-center">
    <img
      alt={alt || symbol}
      className="w-8 h-8 mr-2"
      src={iconSrc}
    />
    <span>{symbol}</span>
  </div>
)
