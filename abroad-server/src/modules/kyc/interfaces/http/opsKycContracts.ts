import { DocumentType, KycStatus } from '@prisma/client'
import { z } from 'zod'

import type {
  OpsKycAssignment,
  OpsKycDetail,
  OpsKycListResult,
  OpsKycReviewer,
  OpsKycUserState,
} from '../../application/OpsKycService'

export type OpsKycAssignmentResponse = OpsKycAssignment

export interface OpsKycAssignRequest {
  reviewerUserId: null | string
}
export type OpsKycDetailResponse = OpsKycDetail
export interface OpsKycDisableUserRequest {
  disabledBy?: string
  reason?: string
}
export type OpsKycListResponse = OpsKycListResult
export interface OpsKycRejectResponse {
  id: string
  status: KycStatus
}

export type OpsKycReviewerListResponse = { items: OpsKycReviewer[] }

export type OpsKycUserStateResponse = OpsKycUserState

const DEFAULT_KYC_PAGE_SIZE = 20
const MAX_KYC_PAGE_SIZE = 100

export const opsKycListQuerySchema = z.object({
  ageHoursGte: z.coerce.number().int().min(1).max(24 * 365).optional(),
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  documentType: z.nativeEnum(DocumentType).optional(),
  nationality: z.string().trim().min(2).max(3).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_KYC_PAGE_SIZE).default(DEFAULT_KYC_PAGE_SIZE),
  partnerId: z.string().uuid().optional(),
  query: z.string().trim().min(2).max(120).optional(),
  reviewer: z.union([z.literal('UNASSIGNED'), z.string().uuid()]).optional(),
  status: z.nativeEnum(KycStatus).optional(),
}).refine(value => !value.createdFrom || !value.createdTo || value.createdFrom <= value.createdTo, {
  message: 'Created from must be before created to',
  path: ['createdTo'],
})

export const opsKycAssignSchema = z.object({
  reviewerUserId: z.string().uuid().nullable(),
}).strict() satisfies z.ZodType<OpsKycAssignRequest>

export const opsKycIdSchema = z.string().uuid('Invalid id')

export const opsKycDisableUserSchema = z.object({
  disabledBy: z.string().trim().min(1).max(200).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
}).strict() satisfies z.ZodType<OpsKycDisableUserRequest>
