import { TargetCurrency, TransactionStatus } from '@prisma/client'

import { TransactionWithRelations } from './transactionNotificationTypes'

type TransactionSlackContext = {
  heading: string
  notes?: Record<string, boolean | null | number | string | undefined>
  status: TransactionStatus
  trigger: string
}

const statusEmoji: Record<TransactionStatus, string> = {
  [TransactionStatus.AWAITING_PAYMENT]: '⌛️',
  [TransactionStatus.PAYMENT_COMPLETED]: '✅',
  [TransactionStatus.PAYMENT_EXPIRED]: '⏰',
  [TransactionStatus.PAYMENT_FAILED]: '❌',
  [TransactionStatus.PROCESSING_PAYMENT]: '🔄',
  [TransactionStatus.WRONG_AMOUNT]: '⚠️',
}

const joinSegments = (segments: Array<null | string | undefined>): string =>
  segments.filter((segment): segment is string => Boolean(segment)).join(' | ')

const buildNotesLine = (
  notes: Record<string, boolean | null | number | string | undefined> | undefined,
): string => {
  if (!notes) {
    return ''
  }

  const renderedNotes = Object.entries(notes)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([label, value]) => `${label}: ${value}`)

  return renderedNotes.length > 0 ? `Notes: ${renderedNotes.join(' | ')}` : ''
}

const currencyCountryCode: Readonly<Record<TargetCurrency, string>> = {
  [TargetCurrency.BRL]: 'BR',
  [TargetCurrency.COP]: 'CO',
}

const toCountryFlag = (currency: TargetCurrency): string => {
  const normalized = currencyCountryCode[currency]?.trim().toUpperCase()
  if (normalized.length !== 2) {
    return currency
  }

  const baseCodePoint = 0x1F1E6
  const offset = normalized.charCodeAt(0) - 65
  const offsetSecond = normalized.charCodeAt(1) - 65
  if (offset < 0 || offset > 25 || offsetSecond < 0 || offsetSecond > 25) {
    return currency
  }

  return String.fromCodePoint(baseCodePoint + offset, baseCodePoint + offsetSecond)
}

export const buildTransactionSlackMessage = (
  transaction: TransactionWithRelations,
  context: TransactionSlackContext,
): string => {
  const amountSummary = `Amounts: ${transaction.quote.sourceAmount} ${transaction.quote.cryptoCurrency}`
    + ` -> ${transaction.quote.targetAmount} ${transaction.quote.targetCurrency}`
  const paymentSummary = joinSegments([
    `Payment: ${transaction.quote.paymentMethod}`,
    `Network: ${transaction.quote.network}`,
    transaction.accountNumber ? `Account: ${transaction.accountNumber}` : null,
  ])
  const references = joinSegments([
    transaction.externalId ? `External: ${transaction.externalId}` : null,
    transaction.onChainId ? `On-chain: ${transaction.onChainId}` : null,
    transaction.refundOnChainId ? `Refund: ${transaction.refundOnChainId}` : null,
  ])

  const emoji = statusEmoji[context.status]
  const countryIcon = toCountryFlag(transaction.quote.targetCurrency)
  const lines = [
    `${emoji} ${context.heading} | Status: ${context.status} | Trigger: ${context.trigger} | Country: ${countryIcon}`,
    joinSegments([
      `Transaction: ${transaction.id}`,
      `Quote: ${transaction.quote.id}`,
    ]),
    joinSegments([
      `Partner: ${transaction.partnerUser.partner.name} (${transaction.partnerUser.partner.id})`,
      `User: ${transaction.partnerUser.userId}`,
    ]),
    amountSummary,
    paymentSummary,
  ].filter(Boolean) as string[]

  if (references) {
    lines.push(`References: ${references}`)
  }

  const notesLine = buildNotesLine(context.notes)
  if (notesLine) {
    lines.push(notesLine)
  }

  return lines.join('\n')
}
