import { z } from 'zod'

import type {
  KycDocumentType,
  KycSubmissionStatus,
} from '../../features/swap/types'
import type { ApiResult } from '../http/types'

import { httpClient } from '../http/httpClient'

const kycSubmissionStatusSchema = z.enum([
  'APPROVED',
  'PENDING',
  'PENDING_APPROVAL',
  'REJECTED',
])

const kycStatusResponseSchema = z.object({
  hasApproved: z.boolean(),
  status: kycSubmissionStatusSchema.nullable(),
}).strict()

const kycSubmitResponseSchema = z.object({
  status: kycSubmissionStatusSchema,
}).strict()

export type KycStatusResponse = {
  hasApproved: boolean
  status: KycSubmissionStatus | null
}

export interface KycSubmissionPayload {
  address: string
  city: string
  dateOfBirth: string // YYYY-MM-DD
  document: File
  documentNumber: string
  documentType: KycDocumentType
  email: string
  fullName: string
  nationality: string
  phone: string
  userId: string
}

export type KycSubmitResponse = {
  status: KycSubmissionStatus
}

const invalidKycResponse = <T>(result: Extract<ApiResult<T>, { ok: true }>): ApiResult<T> => ({
  error: {
    body: null,
    message: 'Invalid identity verification response',
    status: result.status,
    type: 'parse',
  },
  headers: result.headers,
  ok: false,
  status: result.status,
})

/**
 * Submits the self-service KYC form as multipart/form-data. The document image
 * is streamed to the API (field name `document`); the browser sets the
 * multipart Content-Type/boundary, so we intentionally send no explicit header.
 * The Bearer token is attached by httpClient.
 */
export const submitKyc = async (
  payload: KycSubmissionPayload,
): Promise<ApiResult<KycSubmitResponse>> => {
  const formData = new FormData()
  formData.append('userId', payload.userId)
  formData.append('fullName', payload.fullName)
  formData.append('documentType', payload.documentType)
  formData.append('documentNumber', payload.documentNumber)
  formData.append('dateOfBirth', payload.dateOfBirth)
  formData.append('nationality', payload.nationality)
  formData.append('city', payload.city)
  formData.append('address', payload.address)
  formData.append('email', payload.email)
  formData.append('phone', payload.phone)
  formData.append('document', payload.document)

  const result = await httpClient.request<KycSubmitResponse>('/kyc', {
    body: formData,
    method: 'POST',
  })
  if (!result.ok) return result
  const parsed = kycSubmitResponseSchema.safeParse(result.data)
  return parsed.success ? { ...result, data: parsed.data } : invalidKycResponse(result)
}

export const getKycStatus = async (
  userId: string,
  options?: { signal?: AbortSignal | null },
): Promise<ApiResult<KycStatusResponse>> => {
  const result = await httpClient.request<KycStatusResponse>('/kyc/status', {
    method: 'GET',
    query: { userId },
    signal: options?.signal ?? null,
  })
  if (!result.ok) return result
  const parsed = kycStatusResponseSchema.safeParse(result.data)
  return parsed.success ? { ...result, data: parsed.data } : invalidKycResponse(result)
}
