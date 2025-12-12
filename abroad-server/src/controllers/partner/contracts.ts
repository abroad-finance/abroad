import type { Partner } from '@prisma/client'

import { z } from 'zod'

export const createPartnerRequestSchema = z.object({
  company: z.string().min(1),
  country: z.string().min(1),
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  password: z.string().min(8),
  phone: z.string().optional(),
})

export type CreatePartnerRequest = z.infer<typeof createPartnerRequestSchema>

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
