import { useTranslate } from '@tolgee/react'
import { useReducedMotion } from 'framer-motion'
import { Check, Copy, ExternalLink } from 'lucide-react'
import React, { useState } from 'react'

import { IconAnimated } from '../../../shared/components/IconAnimated'
import { ABROAD_SUPPORT_URL } from '../../../shared/constants'
import { maskRecipient } from '../shared/recipientPresentation'

export type AuthorizationWalletCategory
  = | 'browser'
    | 'minipay'
    | 'stellar'
    | 'unknown'
    | 'walletconnect'

export interface WaitSignProps {
  isDark?: boolean
  networkLabel: string
  recipient: string
  recipientName?: string
  sourceAmount: string
  sourceAsset: string
  transactionId: null | string
  walletCategory: AuthorizationWalletCategory
}

const WaitSign = ({
  isDark = false,
  networkLabel,
  recipient,
  recipientName,
  sourceAmount,
  sourceAsset,
  transactionId,
  walletCategory,
}: WaitSignProps): React.JSX.Element => {
  const { t } = useTranslate()
  const reduceMotion = useReducedMotion()
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<null | string>(null)
  const namedWallet = walletCategory === 'browser'
    ? t('wait_sign.wallet.browser', 'browser wallet')
    : walletCategory === 'minipay'
      ? 'MiniPay'
      : walletCategory === 'stellar'
        ? t('wait_sign.wallet.stellar', 'Stellar wallet')
        : walletCategory === 'walletconnect'
          ? t('wait_sign.wallet.walletconnect', 'connected wallet')
          : t('wait_sign.wallet.default', 'wallet')
  const recipientDisplay = recipientName?.trim() || maskRecipient(recipient)
  const authorizationInstruction = walletCategory === 'minipay'
    ? t('wait_sign.instruction.minipay', 'Return to MiniPay and approve this transfer. Come back here after MiniPay confirms it.')
    : walletCategory === 'stellar'
      ? t('wait_sign.instruction.stellar', 'Choose your Stellar wallet if asked, review the transfer there, and approve it once.')
      : walletCategory === 'walletconnect'
        ? t('wait_sign.instruction.walletconnect', 'Open the connected wallet, review the network and amount, and approve the transfer once.')
        : t('wait_sign.instruction.default', 'Open your wallet, review the network and amount, and approve the transfer once.')

  const copyTransactionId = async (): Promise<void> => {
    if (!transactionId) return
    setCopyError(null)
    try {
      await navigator.clipboard.writeText(transactionId)
      setCopied(true)
    }
    catch {
      setCopied(false)
      setCopyError(t('wait_sign.copy_error', 'Could not copy the Abroad ID. Select the ID and copy it manually.'))
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 items-center justify-center px-4 py-6">
      <section aria-busy="true" aria-live="polite" className="flex w-full flex-col items-center rounded-3xl border border-[var(--ab-border)] bg-[var(--ab-card)] p-5 text-[var(--ab-text)] shadow-sm sm:p-8" role="status">
        <IconAnimated
          colors={isDark ? 'primary:#e0f0ec,secondary:#73B9A3' : 'primary:#356E6A,secondary:#26A17B'}
          icon="DocumentSign"
          loop={!reduceMotion}
          play={!reduceMotion}
          size={132}
        />
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--ab-green)]">
          {t('wait_sign.step', 'Authorize payment')}
        </p>
        <h1 className="mt-2 text-center font-cereal text-2xl font-bold">
          {sourceAmount
            ? t('wait_sign.title_amount', 'Approve {amount} {asset} in your {wallet}', {
                amount: sourceAmount,
                asset: sourceAsset,
                wallet: namedWallet,
              })
            : t('wait_sign.title', 'Approve the transfer in your {wallet}', { wallet: namedWallet })}
        </h1>
        <p className="mt-3 max-w-md text-center text-sm leading-6 text-[var(--ab-text-secondary)]">
          {authorizationInstruction}
        </p>

        <dl className="mt-6 grid w-full gap-3 rounded-2xl bg-[var(--ab-bg-subtle)] p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold text-[var(--ab-text-muted)]">{t('wait_sign.pay_from', 'Pay from')}</dt>
            <dd className="mt-1 font-bold tabular-nums">{sourceAmount ? `${sourceAmount} ${sourceAsset}` : t('common.unavailable', 'Unavailable')}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-[var(--ab-text-muted)]">{t('wait_sign.network', 'Network')}</dt>
            <dd className="mt-1 font-bold">{networkLabel || t('common.unavailable', 'Unavailable')}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold text-[var(--ab-text-muted)]">{t('wait_sign.recipient', 'Recipient')}</dt>
            <dd className="mt-1 break-words font-bold">{recipientDisplay || t('confirm_qr.recipient_in_qr', 'Encoded in QR code')}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold text-[var(--ab-text-muted)]">{t('wait_sign.abroad_id', 'Abroad ID')}</dt>
            <dd className="mt-1 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <code className="break-all text-xs font-semibold">{transactionId ?? t('common.unavailable', 'Unavailable')}</code>
              {transactionId && (
                <button className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-[var(--ab-border)] px-3 font-semibold" onClick={() => void copyTransactionId()} type="button">
                  {copied ? <Check aria-hidden="true" className="h-4 w-4" /> : <Copy aria-hidden="true" className="h-4 w-4" />}
                  {copied ? t('common.copied', 'Copied') : t('common.copy', 'Copy')}
                </button>
              )}
            </dd>
            {copyError && <dd className="mt-2 text-xs font-semibold text-red-700" role="alert">{copyError}</dd>}
          </div>
        </dl>

        <div className="mt-5 w-full rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-950">
          <p className="font-semibold">{t('wait_sign.request_created', 'Your Abroad request is already created.')}</p>
          <p className="mt-1">{t('wait_sign.no_duplicate', 'If your wallet response is unclear, do not start another payment. Abroad will reconcile this ID and you can continue tracking it in Activity.')}</p>
        </div>
        <a className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold text-[var(--ab-green)] hover:bg-[var(--ab-green-soft)]" href={ABROAD_SUPPORT_URL} rel="noopener noreferrer" target="_blank">
          {t('common.need_help', 'Need help?')}
          <ExternalLink aria-hidden="true" className="h-4 w-4" />
        </a>
      </section>
    </main>
  )
}

export default WaitSign
