type TransactionWithBankCode = {
  bankCode: string
  origin?: unknown
}

export const toWebhookTransactionPayload = <T extends TransactionWithBankCode>(
  transaction: T,
): Omit<T, 'bankCode' | 'origin'> => {
  const { bankCode, origin, ...payload } = transaction
  void bankCode
  void origin
  return payload
}
