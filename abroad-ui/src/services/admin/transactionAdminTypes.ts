export const reconciliationBlockchains = [
  'STELLAR',
  'SOLANA',
  'CELO',
] as const

export type OpsReconcileTransactionHashInput = {
  blockchain: typeof reconciliationBlockchains[number]
  on_chain_tx: string
  transaction_id?: string
}

export type OpsReconcileTransactionHashResponse = {
  blockchain: typeof reconciliationBlockchains[number]
  on_chain_tx: string
  reason?: string
  result: ReconciliationResult
  transaction_id: null | string
  transaction_status: null | string
}

export type ReconciliationResult
  = 'alreadyProcessed'
    | 'enqueued'
    | 'failed'
    | 'invalid'
    | 'notFound'
    | 'unresolved'
