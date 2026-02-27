import { ChevronDown } from 'lucide-react'
import React from 'react'

import { cn } from '../../shared/utils'

export interface ChainPillChain {
  bgColor: string
  color: string
  icon: string
  name: string
}

export interface ChainPillProps {
  chain: ChainPillChain
  compact?: boolean
  onClick: () => void
  tokenLabel: string
  className?: string
}

/**
 * Compact chain + token indicator (e.g. "USDC on Stellar"). Clickable to open chain selector.
 */
export const ChainPill: React.FC<ChainPillProps> = ({
  chain,
  compact = false,
  onClick,
  tokenLabel,
  className,
}) => (
  <button
    className={cn(
      'inline-flex items-center gap-1.5 rounded-[10px] border cursor-pointer',
      'transition-[background,border-color] duration-[0.4s] ease-[cubic-bezier(0.16,1,0.3,1)]',
      compact ? 'px-2.5 py-1.5' : 'px-3.5 py-2',
      className,
    )}
    onClick={onClick}
    style={{
      background: chain.bgColor,
      borderColor: `${chain.color}25`,
      borderWidth: '1.5px',
    }}
    type="button"
  >
    <span className={compact ? 'text-xs' : 'text-sm'}>{chain.icon}</span>
    <span
      className={cn(
        'font-bold',
        compact ? 'text-[11px]' : 'text-xs',
      )}
      style={{ color: chain.color === '#FCFF52' ? '#35D07F' : chain.color }}
    >
      {tokenLabel}
      {' on '}
      {chain.name}
    </span>
    <ChevronDown className="h-3 w-3 text-[var(--ab-text-muted)]" />
  </button>
)
