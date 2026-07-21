import { KycStatus } from '@prisma/client'
import { z } from 'zod'

import type { OpsKycListResult, OpsKycUserState } from '../../application/OpsKycService'

export interface OpsKycDisableUserRequest {
  disabledBy?: string
  reason?: string
}
export type OpsKycListResponse = OpsKycListResult

export interface OpsKycRejectResponse {
  id: string
  status: KycStatus
}

export type OpsKycUserStateResponse = OpsKycUserState

const DEFAULT_KYC_PAGE_SIZE = 20
const MAX_KYC_PAGE_SIZE = 100

export const opsKycListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_KYC_PAGE_SIZE).default(DEFAULT_KYC_PAGE_SIZE),
  status: z.nativeEnum(KycStatus).optional(),
})

export const opsKycIdSchema = z.string().uuid('Invalid id')

export const opsKycDisableUserSchema = z.object({
  disabledBy: z.string().trim().min(1).max(200).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict() satisfies z.ZodType<OpsKycDisableUserRequest>
