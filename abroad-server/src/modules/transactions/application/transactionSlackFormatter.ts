import { TransactionStatus } from '@prisma/client'

import { TransactionWithRelations } from './transactionNotificationTypes'

type TransactionSlackContext = {
  heading: string
  notes?: Record<string, boolean | null | number | string | undefined>
  status: TransactionStatus
  trigger: string
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
    transaction.bankCode ? `Bank: ${transaction.bankCode}` : null,
  ])
  const references = joinSegments([
    transaction.externalId ? `External: ${transaction.externalId}` : null,
    transaction.onChainId ? `On-chain: ${transaction.onChainId}` : null,
    transaction.refundOnChainId ? `Refund: ${transaction.refundOnChainId}` : null,
  ])

  const lines = [
    `${context.heading} | Status: ${context.status} | Trigger: ${context.trigger}`,
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
