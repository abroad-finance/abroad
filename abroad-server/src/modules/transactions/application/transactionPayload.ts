type TransactionWithBankCode = {
  bankCode: string
  origin?: unknown
}

type UserNotifiableTransaction = {
  createdAt?: Date | string
  cryptoCurrency?: unknown
  id: string
  onChainId?: null | string
  quote?: null | unknown
  status: string
  updatedAt?: Date | string
}

/**
 * What an end user is allowed to see about their own transaction.
 *
 * This is deliberately an allow-list rather than an omit-list. The webhook
 * payload below is shaped for the *partner* and carries the whole relation
 * graph, including `partnerUser.partner` — i.e. the partner's `apiKey`,
 * `previousApiKey`, `email` and `phone`. That object used to be forwarded
 * verbatim to the user's websocket room, so every transaction event published
 * the partner's API credentials to a browser. Anything added here reaches
 * customers, so add fields consciously.
 */
export const toUserTransactionPayload = <T extends UserNotifiableTransaction>(
  transaction: T,
): {
  cryptoCurrency?: unknown
  id: string
  onChainId?: null | string
  quote?: null | unknown
  status: string
  updatedAt?: string
} => ({
  cryptoCurrency: transaction.cryptoCurrency,
  id: transaction.id,
  onChainId: transaction.onChainId ?? null,
  quote: transaction.quote ?? null,
  status: transaction.status,
  updatedAt: transaction.updatedAt === undefined
    ? undefined
    : new Date(transaction.updatedAt).toISOString(),
})

export const toWebhookTransactionPayload = <T extends TransactionWithBankCode>(
  transaction: T,
): Omit<T, 'bankCode' | 'origin'> => {
  const { bankCode, origin, ...payload } = transaction
  void bankCode
  void origin
  return payload
}
