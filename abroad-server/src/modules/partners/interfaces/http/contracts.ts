import type { Partner } from '@prisma/client'

import { z } from 'zod'

export interface CreatePartnerRequest {
  company: string
  country: string
  email: string
  firstName: string
  lastName: string
  phone?: string
}

export const createPartnerRequestSchema = z.object({
  company: z.string().min(1),
  country: z.string().min(1),
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
}).strict() satisfies z.ZodType<CreatePartnerRequest>

export interface CreatePartnerResponse {
  id: string
}

export type PartnerInfoResponse = Pick<Partner, 'createdAt' | 'id' | 'name'> & {
  country?: string
  email?: string
  firstName?: string
  isKybApproved?: boolean
  lastName?: string
  needsKyc?: boolean
  phone?: string
}
