import { Request as ExpressRequest } from 'express'
import { z, type ZodType } from 'zod'

export const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

export type AuthenticatedRequest = ExpressRequest & { user: { id: string } }

export interface CreatePartnerUserRequest {
  kycExternalToken?: null | string
  userId: string
}

export interface PaginatedPartnerUsers {
  page: number
  pageSize: number
  total: number
  users: PartnerUserDto[]
}

export interface PartnerUserDto {
  createdAt: Date
  id: string
  kycToken: null | string
  updatedAt: Date
  userId: string
}

export interface UpdatePartnerUserRequest {
  kycExternalToken?: null | string
}

const kycToken = z.string().min(1).nullable().optional()

export const createPartnerUserSchema: ZodType<CreatePartnerUserRequest> = z.object({
  kycExternalToken: kycToken,
  kycToken,
  userId: z.string().uuid(),
})

export const updatePartnerUserSchema: ZodType<UpdatePartnerUserRequest> = z
  .object({
    kycExternalToken: kycToken,
  })
  .refine(payload => Object.keys(payload).length > 0, {
    message: 'At least one field must be supplied',
  })

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
})

type PaginationParams = { page?: number, pageSize?: number }

export function parsePagination(params: PaginationParams): { data: { page: number, pageSize: number } } | { error: string } {
  const parsed = paginationSchema.safeParse(params)
  if (!parsed.success) {
    const reason = parsed.error.issues[0]?.message ?? 'Invalid pagination parameters'
    return { error: reason }
  }
  return { data: parsed.data }
}

export function parsePayload<T>(schema: ZodType<T>, payload: unknown): { data: T } | { error: string } {
  const validation = schema.safeParse(payload)
  if (!validation.success) {
    return { error: validation.error.issues[0]?.message ?? 'Invalid payload' }
  }
  return { data: validation.data }
}
