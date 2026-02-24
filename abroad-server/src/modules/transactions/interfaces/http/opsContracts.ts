import { BlockchainNetwork, TransactionStatus } from '@prisma/client'
import { z } from 'zod'

import { OpsTransactionReconciliationResultCode } from '../../application/OpsTransactionReconciliationService'

export const opsReconcileHashRequestSchema = z.object({
  blockchain: z.nativeEnum(BlockchainNetwork),
  on_chain_tx: z.string().trim().min(1, 'on_chain_tx is required'),
  transaction_id: z.string().uuid().optional(),
})

export interface OpsReconcileHashRequest {
  blockchain: BlockchainNetwork
  on_chain_tx: string
  transaction_id?: string
}

export interface OpsReconcileHashResponse {
  blockchain: BlockchainNetwork
  on_chain_tx: string
  reason?: string
  result: OpsTransactionReconciliationResultCode
  transaction_id: null | string
  transaction_status: null | TransactionStatus
}
