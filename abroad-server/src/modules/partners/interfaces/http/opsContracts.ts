import { z } from 'zod'

import type {
  OpsPartnerClientDomainInput,
  OpsPartnerCreateInput,
  OpsPartnerCreateResult,
  OpsPartnerCredentialHistory,
  OpsPartnerKybApprovalInput,
  OpsPartnerKycRequirementInput,
  OpsPartnerListResult,
  OpsPartnerProfileInput,
  OpsPartnerRotateApiKeyResult,
  OpsPartnerStatusInput,
  OpsPartnerSummary,
  OpsPartnerWebhookInput,
} from '../../application/OpsPartnerService'
import type { PartnerPortalCredentials, PartnerPortalUserProvisioningResult } from '../../application/PartnerPortalAccountService'

import { createPartnerRequestSchema } from './contracts'

export const DEFAULT_PARTNER_PAGE_SIZE = 20
const MAX_PARTNER_PAGE_SIZE = 100

export type OpsCreatePartnerRequest = OpsPartnerCreateInput
export type OpsCreatePartnerResponse = OpsPartnerCreateResult
export type OpsPartnerCredentialHistoryResponse = OpsPartnerCredentialHistory
export type OpsPartnerDto = OpsPartnerSummary
export type OpsPartnerListResponse = OpsPartnerListResult
export type OpsRotatePartnerApiKeyResponse = OpsPartnerRotateApiKeyResult
export type OpsUpdatePartnerClientDomainRequest = OpsPartnerClientDomainInput
export type OpsUpdatePartnerClientDomainResponse = OpsPartnerSummary
export type OpsUpdatePartnerKybRequest = OpsPartnerKybApprovalInput
export type OpsUpdatePartnerKybResponse = OpsPartnerSummary
export type OpsUpdatePartnerKycRequest = OpsPartnerKycRequirementInput
export type OpsUpdatePartnerKycResponse = OpsPartnerSummary
export type OpsUpdatePartnerProfileRequest = OpsPartnerProfileInput
export type OpsUpdatePartnerProfileResponse = OpsPartnerSummary
export type OpsUpdatePartnerStatusRequest = OpsPartnerStatusInput
export type OpsUpdatePartnerStatusResponse = OpsPartnerSummary
export type OpsUpdatePartnerWebhookRequest = OpsPartnerWebhookInput
export type OpsUpdatePartnerWebhookResponse = OpsPartnerSummary
export type OpsUpsertPartnerPortalUserRequest = PartnerPortalCredentials
export type OpsUpsertPartnerPortalUserResponse = PartnerPortalUserProvisioningResult

const partnerIdSchema = z.string().uuid()
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PARTNER_PAGE_SIZE).default(DEFAULT_PARTNER_PAGE_SIZE),
})
const updatePartnerClientDomainSchema = z.object({
  clientDomain: z.string().nullable(),
}).strict() satisfies z.ZodType<OpsUpdatePartnerClientDomainRequest>
const updatePartnerKycSchema = z.object({
  needsKyc: z.boolean(),
}).strict() satisfies z.ZodType<OpsUpdatePartnerKycRequest>
const updatePartnerKybSchema = z.object({
  isKybApproved: z.boolean(),
}).strict() satisfies z.ZodType<OpsUpdatePartnerKybRequest>
// Every field optional so a caller can PATCH one at a time; `.refine` keeps an
// empty body from silently succeeding as a no-op update.
const updatePartnerProfileSchema = z.object({
  country: z.string().trim().max(2).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  firstName: z.string().trim().max(100).nullable().optional(),
  lastName: z.string().trim().max(100).nullable().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  phone: z.string().trim().max(30).nullable().optional(),
}).strict().refine(
  value => Object.keys(value).length > 0,
  { message: 'Provide at least one profile field to update' },
) satisfies z.ZodType<OpsUpdatePartnerProfileRequest>
const updatePartnerStatusSchema = z.object({
  disabled: z.boolean(),
  reason: z.string().trim().max(500).nullable().optional(),
}).strict() satisfies z.ZodType<OpsUpdatePartnerStatusRequest>
const updatePartnerWebhookSchema = z.object({
  webhookUrl: z.string().trim().url().max(2048).nullable(),
}).strict() satisfies z.ZodType<OpsUpdatePartnerWebhookRequest>
const upsertPartnerPortalUserSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
}).strict() satisfies z.ZodType<OpsUpsertPartnerPortalUserRequest>

type PaginationInput = {
  page?: number
  pageSize?: number
}

export const opsCreatePartnerRequestSchema = createPartnerRequestSchema
export const opsUpdatePartnerClientDomainRequestSchema = updatePartnerClientDomainSchema
export const opsUpdatePartnerKybRequestSchema = updatePartnerKybSchema
export const opsUpdatePartnerKycRequestSchema = updatePartnerKycSchema
export const opsUpdatePartnerProfileRequestSchema = updatePartnerProfileSchema
export const opsUpdatePartnerStatusRequestSchema = updatePartnerStatusSchema
export const opsUpdatePartnerWebhookRequestSchema = updatePartnerWebhookSchema
export const opsUpsertPartnerPortalUserRequestSchema = upsertPartnerPortalUserSchema

export const parsePartnerId = (value: string): { data: string } | { error: string } => {
  const parsed = partnerIdSchema.safeParse(value)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid partner id' }
  }
  return { data: parsed.data }
}

export const parsePartnerPagination = (
  value: PaginationInput,
): { data: { page: number, pageSize: number } } | { error: string } => {
  const parsed = paginationSchema.safeParse(value)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid pagination parameters' }
  }
  return { data: parsed.data }
}
