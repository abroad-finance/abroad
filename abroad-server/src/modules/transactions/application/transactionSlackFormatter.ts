import { Country, TransactionStatus } from '@prisma/client'

import { TransactionWithRelations } from './transactionNotificationTypes'

type TransactionSlackContext = {
  flags?: ReadonlyArray<string>
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

const COUNTRY_FLAGS: Readonly<Record<Country, string>> = {
  [Country.CO]: '🇨🇴',
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

const buildFlagsLine = (flags: ReadonlyArray<string> | undefined): string => {
  if (!flags || flags.length === 0) {
    return ''
  }

  const normalizedFlags = flags
    .map(flag => flag.trim())
    .filter(flag => flag.length > 0)

  const uniqueFlags = Array.from(new Set(normalizedFlags))
  return uniqueFlags.length > 0 ? `Flags: ${uniqueFlags.join(' | ')}` : ''
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
  const countryIcon = COUNTRY_FLAGS[transaction.quote.country] ?? transaction.quote.country
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

  const flagsLine = buildFlagsLine(context.flags)
  if (flagsLine) {
    lines.push(flagsLine)
  }

  const notesLine = buildNotesLine(context.notes)
  if (notesLine) {
    lines.push(notesLine)
  }

  return lines.join('\n')
}
