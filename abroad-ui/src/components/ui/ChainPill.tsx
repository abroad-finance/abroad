import { ChevronDown } from 'lucide-react'
import React from 'react'

import { cn } from '../../shared/utils'

export interface ChainPillChain {
  /** Emoji fallback when iconUrl is not set */
  icon: string
  /** Optional chain icon URL (Figma 9:562 – matches HomeScreen pill) */
  iconUrl?: string
  name: string
  /** @deprecated use neutral pill styles (Figma 9:562) */
  bgColor?: string
  /** @deprecated use neutral pill styles (Figma 9:562) */
  color?: string
}

export interface ChainPillProps {
  chain: ChainPillChain
  compact?: boolean
  onClick: () => void
  tokenLabel: string
  className?: string
}

/** Figma 9:562 / HomeScreen – neutral pill styles for chain selector */
const PILL_CLASS = 'flex items-center gap-2 rounded-full border border-[#e5e7eb] bg-[#f3f4f6] px-[13px] py-[7px] transition-colors hover:opacity-90 cursor-pointer'

/**
 * Chain + token indicator (e.g. "USDC on Stellar"). Clickable to open chain selector.
 * Matches HomeScreen and Figma node 9:562.
 */
export const ChainPill: React.FC<ChainPillProps> = ({
  chain,
  compact = false,
  onClick,
  tokenLabel,
  className,
}) => (
  <button
    className={cn(PILL_CLASS, className)}
    onClick={onClick}
    type="button"
  >
    {chain.iconUrl ? (
      <img alt={chain.name} className="h-5 w-5" src={chain.iconUrl} />
    ) : (
      <span className="text-sm">{chain.icon}</span>
    )}
    <span className="text-xs font-semibold text-[#374151]">
      {tokenLabel}
      {' on '}
      {chain.name}
    </span>
    <ChevronDown className="h-4 w-4 text-[#374151]" />
  </button>
)
