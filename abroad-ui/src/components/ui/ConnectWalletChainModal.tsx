import { useTranslate } from '@tolgee/react'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Coins,
  X,
} from 'lucide-react'
import React, {
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react'

import { ModalSurface } from '../../shared/components/ModalSurface'
import { CHAIN_CONFIG, TOKEN_ICONS } from '../../shared/constants'
import { cn } from '../../shared/utils'

export interface ConnectWalletChainModalProps {
  onClose: (outcome?: 'dismissed' | 'selected') => void
  onConnectRequest: () => void
  onSelectSource: (key: string) => void
  open: boolean
  options: WalletSourceOption[]
}

export interface WalletSourceOption {
  chainKey: string
  chainLabel: string
  key: string
  sourceAsset: string
  walletLabel: string
}

type SourceGroup = {
  asset: string
  options: WalletSourceOption[]
}

const sourceGroups = (options: WalletSourceOption[]): SourceGroup[] => {
  const grouped = new Map<string, WalletSourceOption[]>()
  for (const option of options) {
    grouped.set(option.sourceAsset, [...(grouped.get(option.sourceAsset) ?? []), option])
  }
  return [...grouped.entries()]
    .map(([asset, groupOptions]) => ({ asset, options: groupOptions }))
    .sort((left, right) => left.asset.localeCompare(right.asset))
}

export const ConnectWalletChainModal: React.FC<ConnectWalletChainModalProps> = ({
  onClose,
  onConnectRequest,
  onSelectSource,
  open,
  options,
}: Readonly<ConnectWalletChainModalProps>): null | React.JSX.Element => {
  const { t } = useTranslate()
  const descriptionId = useId()
  const titleId = useId()
  const groups = useMemo(() => sourceGroups(options), [options])
  const [selectedAsset, setSelectedAsset] = useState<null | string>(null)
  const [selectedOptionKey, setSelectedOptionKey] = useState<null | string>(null)

  useEffect(() => {
    if (open) return
    setSelectedAsset(null)
    setSelectedOptionKey(null)
  }, [open])

  if (!open) return null

  const selectedGroup = groups.find(group => group.asset === selectedAsset) ?? null
  const selectedOption = options.find(option => option.key === selectedOptionKey) ?? null
  const handleConfirm = (): void => {
    if (!selectedOption) return
    onSelectSource(selectedOption.key)
    onConnectRequest()
    onClose('selected')
  }

  return (
    <ModalSurface descriptionId={descriptionId} onClose={onClose} open={open} titleId={titleId}>
      <motion.div
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-[440px] rounded-3xl bg-[var(--ab-bg-card)] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.12)]"
        exit={{ opacity: 0, scale: 0.98, y: 8 }}
        initial={{ opacity: 0, scale: 0.98, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            {selectedGroup && (
              <button
                aria-label={t('connect_wallet.back_to_assets', 'Back to source assets')}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-[var(--ab-text-muted)] transition-colors hover:bg-[var(--ab-bg-muted)]"
                onClick={() => {
                  setSelectedAsset(null)
                  setSelectedOptionKey(null)
                }}
                type="button"
              >
                <ArrowLeft aria-hidden="true" className="h-5 w-5" />
              </button>
            )}
            <h2 className="truncate font-cereal text-xl font-bold text-[var(--ab-text)]" id={titleId}>
              {selectedGroup
                ? t('connect_wallet.choose_network', 'Choose a compatible network')
                : t('connect_wallet.choose_source', 'What do you want to pay with?')}
            </h2>
          </div>
          <button
            aria-label={t('connect_wallet.close', 'Close wallet selector')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--ab-bg-muted)] text-[var(--ab-text-muted)] transition-colors"
            data-modal-initial-focus
            onClick={() => onClose('dismissed')}
            type="button"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-6 text-sm leading-6 text-[var(--ab-text-secondary)]" id={descriptionId}>
          {selectedGroup
            ? t('connect_wallet.network_description', 'Only networks compatible with {asset} and this payment destination are shown. You will confirm both before your wallet opens.', { asset: selectedGroup.asset })
            : t('connect_wallet.source_description', 'Choose the stablecoin already in your wallet. We will show only compatible networks next.')}
        </p>

        {!selectedGroup && groups.length > 0 && (
          <div aria-label={t('connect_wallet.source_options', 'Source asset options')} className="flex flex-col gap-3" role="group">
            {groups.map((group) => {
              const tokenIcon = TOKEN_ICONS[group.asset]
              const networkNames = group.options.map(option => getChainName(option.chainLabel)).join(', ')
              return (
                <button
                  className="flex min-h-16 items-center gap-4 rounded-2xl border-2 border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] px-5 py-4 text-left transition-colors hover:border-[var(--ab-green)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)]"
                  key={group.asset}
                  onClick={() => setSelectedAsset(group.asset)}
                  type="button"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white">
                    {tokenIcon
                      ? <img alt="" className="h-7 w-7 object-contain" src={tokenIcon} />
                      : <Coins aria-hidden="true" className="h-6 w-6 text-[var(--ab-green)]" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-cereal text-base font-semibold text-[var(--ab-text)]">{group.asset}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--ab-text-muted)]">
                      {t('connect_wallet.compatible_networks', 'Compatible networks: {networks}', { networks: networkNames })}
                    </p>
                  </div>
                  <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0 text-[var(--ab-text-muted)]" />
                </button>
              )
            })}
          </div>
        )}

        {selectedGroup && (
          <>
            <div aria-label={t('connect_wallet.network_options', 'Compatible network options')} className="flex flex-col gap-3" role="group">
              {selectedGroup.options.map((option) => {
                const config = getChainConfig(option.chainLabel)
                const chainName = getChainName(option.chainLabel)
                const isSelected = option.key === selectedOptionKey
                return (
                  <button
                    aria-pressed={isSelected}
                    className={cn(
                      'flex min-h-16 items-center gap-4 rounded-2xl border-2 px-5 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)]',
                      isSelected
                        ? 'border-[var(--ab-green)] bg-[var(--ab-green-soft)]'
                        : 'border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] hover:border-[var(--ab-green)]',
                    )}
                    key={option.key}
                    onClick={() => setSelectedOptionKey(option.key)}
                    type="button"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--ab-bg-muted)]">
                      <img alt="" className="h-7 w-7 object-contain" src={config.icon} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-cereal text-base font-semibold text-[var(--ab-text)]">{chainName}</p>
                      <p className="mt-1 text-xs text-[var(--ab-text-muted)]">{option.walletLabel}</p>
                    </div>
                    {isSelected
                      ? (
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ab-green)] text-white">
                            <Check aria-hidden="true" className="h-4 w-4" />
                          </span>
                        )
                      : <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0 text-[var(--ab-text-muted)]" />}
                  </button>
                )
              })}
            </div>
            <div className="mt-6 rounded-2xl bg-[var(--ab-bg-subtle)] px-4 py-3 text-sm text-[var(--ab-text-secondary)]">
              {selectedOption
                ? t('connect_wallet.selection_summary', 'Pay with {asset} on {network}. Your wallet will open next.', {
                    asset: selectedOption.sourceAsset,
                    network: getChainName(selectedOption.chainLabel),
                  })
                : t('connect_wallet.select_network_hint', 'Select a network to continue.')}
            </div>
            <button
              className="mt-4 min-h-12 w-full rounded-2xl bg-[var(--ab-green)] px-5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!selectedOption}
              onClick={handleConfirm}
              type="button"
            >
              {selectedOption
                ? t('connect_wallet.confirm', 'Connect and use {asset}', { asset: selectedOption.sourceAsset })
                : t('connect_wallet.confirm_disabled', 'Choose a network')}
            </button>
          </>
        )}

        {groups.length === 0 && (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
            {t('connect_wallet.no_compatible_sources', 'No compatible wallet sources are available for this destination right now.')}
          </p>
        )}
      </motion.div>
    </ModalSurface>
  )
}

function getChainConfig(label: string) {
  const prefix = Object.keys(CHAIN_CONFIG).find(item => label.startsWith(item))
  return prefix ? CHAIN_CONFIG[prefix] : CHAIN_CONFIG.Stellar
}

function getChainName(label: string): string {
  if (label.startsWith('Celo')) return 'Celo'
  if (label.startsWith('Solana')) return 'Solana'
  if (label.startsWith('Stellar')) return 'Stellar'
  return label
}
