type TransactionWithBankCode = {
  bankCode: string
}

export const toWebhookTransactionPayload = <T extends TransactionWithBankCode>(transaction: T): Omit<T, 'bankCode'> => {
  const { bankCode, ...payload } = transaction
  void bankCode
  return payload
}
