import { z } from 'zod'

import type {
  OpsPartnerClientDomainInput,
  OpsPartnerCreateInput,
  OpsPartnerCreateResult,
  OpsPartnerListResult,
  OpsPartnerRotateApiKeyResult,
  OpsPartnerSummary,
} from '../../application/OpsPartnerService'
import type { PartnerPortalCredentials, PartnerPortalUserProvisioningResult } from '../../application/PartnerPortalAccountService'

import { createPartnerRequestSchema } from './contracts'

export const DEFAULT_PARTNER_PAGE_SIZE = 20
const MAX_PARTNER_PAGE_SIZE = 100

export type OpsCreatePartnerRequest = OpsPartnerCreateInput
export type OpsCreatePartnerResponse = OpsPartnerCreateResult
export type OpsPartnerDto = OpsPartnerSummary
export type OpsPartnerListResponse = OpsPartnerListResult
export type OpsRotatePartnerApiKeyResponse = OpsPartnerRotateApiKeyResult
export type OpsUpdatePartnerClientDomainRequest = OpsPartnerClientDomainInput
export type OpsUpdatePartnerClientDomainResponse = OpsPartnerSummary
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
