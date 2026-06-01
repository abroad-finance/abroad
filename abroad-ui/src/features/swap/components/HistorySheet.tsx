import { useTranslate } from '@tolgee/react'
import { Check, ChevronRight, X } from 'lucide-react'
import React from 'react'

import BrebLogo from '@/assets/Logos/networks/Bre-b.svg'
import PixLogo from '@/assets/Logos/networks/PixFull.svg'
import { BottomSheet } from '@/shared/components'
import {
  CURRENCY_FLAG_URL, resolveChainConfig, resolveCountryConfig, TOKEN_ICONS,
} from '@/shared/constants'
import { cn, isLocalTxExpired } from '@/shared/utils'

import type { TxDetailItem } from '../constants'

export interface HistorySheetProps {
  onClose: () => void
  onSelectTx: (tx: TxDetailItem) => void
  transactions: TxDetailItem[]
}

export default function HistorySheet({ onClose, onSelectTx, transactions }: Readonly<HistorySheetProps>): React.JSX.Element {
  const { t } = useTranslate()

  return (
    <BottomSheet onClose={onClose}>
      <div className="px-6 pb-9 pt-1">
        <h3 className="font-cereal mb-5 text-lg font-bold text-[var(--ab-text)]">{t('history.title', 'Payment History')}</h3>
        {transactions.length === 0
          ? (
              <p className="py-8 text-center text-sm text-[var(--ab-text-muted)]">{t('history.empty', 'No transactions yet.')}</p>
            )
          : (
              <div className="divide-y divide-[var(--ab-border)]">
                {transactions.map((tx, i) => {
                  const isExpired = isLocalTxExpired(tx.status)
                  const isCompleted = tx.status === 'completed'
                  const country = resolveCountryConfig(tx.country)
                  const chain = resolveChainConfig(tx.chain)
                  const railLogo = tx.country === 'br' ? PixLogo : BrebLogo
                  return (
                    <button
                      className="flex w-full items-center gap-3.5 py-3.5 text-left"
                      key={tx.transactionId ?? i}
                      onClick={() => {
                        onSelectTx(tx)
                        onClose()
                      }}
                      type="button"
                    >
                      <div
                        className={cn(
                          'relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[15px] border',
                          isExpired
                            ? 'border-[var(--ab-red-border)] bg-[var(--ab-red-soft)]'
                            : isCompleted
                              ? 'border-[var(--ab-green-border)] bg-[var(--ab-green-soft)]'
                              : 'border-[var(--ab-border)] bg-[var(--ab-bg-muted)]',
                        )}
                      >
                        <img alt={country.currency} className="h-7 w-7 rounded-full" src={country.flagUrl} />
                        {isExpired && (
                          <div className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-white bg-[var(--ab-red)]">
                            <X className="h-1.5 w-1.5 text-white" strokeWidth={3} />
                          </div>
                        )}
                        {isCompleted && (
                          <div className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-white bg-[var(--ab-green)]">
                            <Check className="h-1.5 w-1.5 text-white" strokeWidth={3} />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            'font-cereal text-sm font-semibold',
                            isExpired ? 'text-[var(--ab-text-muted)] line-through' : 'text-[var(--ab-text)]',
                          )}
                        >
                          {tx.merchant}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-[var(--ab-text-muted)]">
                          {tx.location ?? (tx.country === 'br' ? t('country.brazil', 'Brazil') : t('country.colombia', 'Colombia'))}
                          {' · '}
                          <img alt={country.rail} className="h-3.5 w-auto max-w-[36px]" src={railLogo} />
                          {' · '}
                          <img
                            alt={tx.chain}
                            className="h-3 w-3"
                            src={chain.icon}
                          />
                          {tx.chain}
                        </div>
                      </div>
                      <div className="text-right">
                        <div
                          className={cn(
                            'font-cereal text-sm font-semibold',
                            isExpired ? 'text-[var(--ab-text-muted)] line-through' : 'text-[var(--ab-text)]',
                          )}
                        >
                          {country.symbol}
                          {tx.localAmount}
                          {' '}
                          <img alt={country.currency} className="ml-0.5 inline-block h-3 w-3 rounded-full" src={CURRENCY_FLAG_URL[country.currency] ?? country.flagUrl} />
                        </div>
                        <div className="text-[11px] text-[var(--ab-text-muted)]">
                          $
                          {tx.usdcAmount}
                          {' '}
                          <img alt={tx.token} className="ml-0.5 inline-block h-3 w-3" src={TOKEN_ICONS[tx.token] ?? TOKEN_ICONS.USDC} />
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--ab-text-muted)]" />
                    </button>
                  )
                })}
              </div>
            )}
      </div>
    </BottomSheet>
  )
}
