import React from 'react'

import { AB_STYLES } from '../constants'

interface TokenBadgeProps {
  alt?: string
  iconSrc?: string
  suffix?: React.ReactNode
  symbol: string
  transparent?: boolean
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

export const TokenBadge: React.FC<TokenBadgeProps> = ({
  alt,
  iconSrc,
  suffix,
  symbol,
  transparent,
}) => (
  <div
    className={`${transparent ? 'p-0' : 'rounded-full px-3 py-1.5'} flex items-center justify-center`}
    style={transparent ? undefined : AB_STYLES.badgeBg}
  >
    {iconSrc
      ? (
          <img
            alt={alt || symbol}
            className="w-6 h-6 mr-2 rounded-full"
            src={iconSrc}
          />
        )
      : (
          <div
            className="w-6 h-6 mr-2 rounded-full flex items-center justify-center text-[10px] font-semibold"
            style={AB_STYLES.hoverAndText}
          >
            {getFallbackInitials(symbol)}
          </div>
        )}
    <span className="truncate max-w-[160px] text-sm font-medium" style={AB_STYLES.text}>
      {symbol}
    </span>
    {suffix && <span className="ml-1">{suffix}</span>}
  </div>
)
