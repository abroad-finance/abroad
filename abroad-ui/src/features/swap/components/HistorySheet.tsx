import { ChevronRight } from 'lucide-react'
import React from 'react'

import type { TxDetailItem } from './TxDetailSheet'

import { BottomSheet } from '../../../components/ui'
import { ASSET_URLS } from '../../../shared/constants'
import { cn } from '../../../shared/utils'

const CHAIN_CONFIG: Record<string, { bg: string, icon: string }> = {
  Celo: { bg: 'var(--ab-chain-celo-bg)', icon: ASSET_URLS.CELO_CHAIN_ICON },
  Solana: { bg: 'var(--ab-chain-solana-bg)', icon: ASSET_URLS.SOLANA_CHAIN_ICON },
  Stellar: { bg: 'var(--ab-chain-stellar-bg)', icon: ASSET_URLS.STELLAR_CHAIN_ICON },
}

const COUNTRY_CONFIG: Record<string, { currency: string, flagUrl: string, rail: string, symbol: string }> = {
  br: {
    currency: 'BRL', flagUrl: 'https://hatscripts.github.io/circle-flags/flags/br.svg', rail: 'PIX', symbol: 'R$',
  },
  co: {
    currency: 'COP', flagUrl: 'https://hatscripts.github.io/circle-flags/flags/co.svg', rail: 'Bre-B', symbol: '$',
  },
}

export interface HistorySheetProps {
  onClose: () => void
  onSelectTx: (tx: TxDetailItem) => void
  transactions: TxDetailItem[]
}

export default function HistorySheet({ onClose, onSelectTx, transactions }: Readonly<HistorySheetProps>): React.JSX.Element {
  return (
    <BottomSheet onClose={onClose}>
      <div className="px-6 pb-9 pt-1">
        <h3 className="font-cereal mb-5 text-lg font-bold text-[var(--ab-text)]">Payment History</h3>
        {transactions.length === 0
          ? (
              <p className="py-8 text-center text-sm text-[var(--ab-text-muted)]">No transactions yet.</p>
            )
          : (
              <div className="divide-y divide-[var(--ab-border)]">
                {transactions.map((tx, i) => {
                  const isExpired = tx.status === 'expired'
                  const country = COUNTRY_CONFIG[tx.country] ?? COUNTRY_CONFIG.co
                  const chain = CHAIN_CONFIG[tx.chain] ?? CHAIN_CONFIG.Stellar
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
                          isExpired ? 'border-[#FECACA] bg-[#FEF2F2]' : 'border-[var(--ab-border)] bg-[var(--ab-bg-muted)]',
                        )}
                      >
                        <img alt={country.currency} className="h-7 w-7 rounded-full" src={country.flagUrl} />
                        {isExpired && (
                          <div className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full border-2 border-white bg-[var(--ab-red)]">
                            <svg className="h-1.5 w-1.5 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
                              <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
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
                          {tx.location ?? (tx.country === 'br' ? 'Brazil' : 'Colombia')}
                          {' · '}
                          {country.rail}
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
                          {country.currency}
                        </div>
                        <div className="text-[11px] text-[var(--ab-text-muted)]">
                          $
                          {tx.usdcAmount}
                          {' '}
                          {tx.token}
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
