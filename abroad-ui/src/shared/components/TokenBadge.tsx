import React from 'react'

interface TokenBadgeProps {
  alt?: string // alt text for icon
  iconSrc?: string // token icon URL
  symbol: string // token symbol text
}

const getFallbackInitials = (symbol: string): string => {
  const trimmed = symbol.trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/\s+/)
  const pickInitial = (part: string) => {
    const match = part.match(/[A-Za-z0-9]/)
    return match ? match[0].toUpperCase() : ''
  }
  const initials = parts.slice(0, 2).map(pickInitial).join('')
  return initials || trimmed[0].toUpperCase()
}

export const TokenBadge: React.FC<TokenBadgeProps> = ({ alt, iconSrc, symbol }) => (
  <div className="bg-white/60 backdrop-blur-xl rounded-4xl px-4 py-2 flex items-center justify-center text-abroad-dark">
    {iconSrc
      ? (
          <img
            alt={alt || symbol}
            className="w-8 h-8 mr-2"
            src={iconSrc}
          />
        )
      : (
          <div className="w-8 h-8 mr-2 rounded-full bg-white/80 border border-black/10 flex items-center justify-center text-[10px] font-semibold">
            {getFallbackInitials(symbol)}
          </div>
        )}
    <span className="truncate max-w-[160px]">{symbol}</span>
  </div>
)
