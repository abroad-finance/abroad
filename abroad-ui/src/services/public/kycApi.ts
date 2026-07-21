import type { ApiResult } from '../http/types'

import { httpClient } from '../http/httpClient'

export type KycStatusResponse = {
  hasApproved: boolean
  status: null | string
}

export interface KycSubmissionPayload {
  address: string
  city: string
  dateOfBirth: string // YYYY-MM-DD
  document: File
  documentNumber: string
  documentType: string
  email: string
  fullName: string
  nationality: string
  phone: string
  userId: string
}

export type KycSubmitResponse = {
  status: string
}

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

  return httpClient.request<KycSubmitResponse>('/kyc', {
    body: formData,
    method: 'POST',
  })
}

export const getKycStatus = async (
  userId: string,
  options?: { signal?: AbortSignal | null },
): Promise<ApiResult<KycStatusResponse>> => {
  return httpClient.request<KycStatusResponse>('/kyc/status', {
    method: 'GET',
    query: { userId },
    signal: options?.signal ?? null,
  })
}
