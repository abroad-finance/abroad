import type {
  OpsKycAssignment,
  OpsKycDetail,
  OpsKycListFilters,
  OpsKycListResponse,
  OpsKycReviewer,
  OpsKycStatus,
  OpsKycUserState,
} from './kycAdminTypes'
import type { OpsMutationDetails } from './opsMutationTypes'

import { adminRequest, unwrapAdminResult } from './adminRequest'
import { getOpsCredentialHeaders } from './opsIdentityApi'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://api.abroad.finance'

export const assignKycReviewer = async (
  kycId: string,
  reviewerUserId: null | string,
  mutation: OpsMutationDetails,
): Promise<OpsKycAssignment> => {
  const result = await adminRequest<OpsKycAssignment>(
    `/ops/kyc/${encodeURIComponent(kycId)}/assign`,
    {
      body: JSON.stringify({ reviewerUserId }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      mutation,
    },
  )
  return unwrapAdminResult(result)
}

export const getKycSubmission = async (kycId: string): Promise<OpsKycDetail> => {
  const result = await adminRequest<OpsKycDetail>(`/ops/kyc/${encodeURIComponent(kycId)}`, {
    method: 'GET',
  })
  return unwrapAdminResult(result)
}

export const listKycReviewers = async (): Promise<OpsKycReviewer[]> => {
  const result = await adminRequest<{ items: OpsKycReviewer[] }>('/ops/kyc/reviewer-options', {
    method: 'GET',
  })
  return unwrapAdminResult(result).items
}

export const listKycSubmissions = async (
  params: OpsKycListFilters = {},
): Promise<OpsKycListResponse> => {
  const result = await adminRequest<OpsKycListResponse>('/ops/kyc', {
    method: 'GET',
    query: {
      ageHoursGte: params.ageHoursGte,
      createdFrom: params.createdFrom,
      createdTo: params.createdTo,
      documentType: params.documentType,
      nationality: params.nationality,
      page: params.page,
      pageSize: params.pageSize,
      partnerId: params.partnerId,
      query: params.query,
      reviewer: params.reviewer,
      status: params.status || undefined,
    },
  })

  return unwrapAdminResult(result)
}

export const disableKycUser = async (
  partnerUserId: string,
  reason: string | undefined,
  mutation: OpsMutationDetails,
): Promise<OpsKycUserState> => {
  const result = await adminRequest<OpsKycUserState>(
    `/ops/kyc/users/${encodeURIComponent(partnerUserId)}/disable`,
    {
      body: JSON.stringify(reason ? { reason } : {}),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      mutation,
    },
  )

  return unwrapAdminResult(result)
}

export const enableKycUser = async (
  partnerUserId: string,
  mutation: OpsMutationDetails,
): Promise<OpsKycUserState> => {
  const result = await adminRequest<OpsKycUserState>(
    `/ops/kyc/users/${encodeURIComponent(partnerUserId)}/enable`,
    { method: 'POST', mutation },
  )

  return unwrapAdminResult(result)
}

export const rejectKyc = async (kycId: string, mutation: OpsMutationDetails): Promise<void> => {
  const result = await adminRequest<{ id: string, status: OpsKycStatus }>(
    `/ops/kyc/${encodeURIComponent(kycId)}/reject`,
    { method: 'POST', mutation },
  )

  unwrapAdminResult(result)
}

export interface KycDocumentPreview {
  contentType: string
  objectUrl: string
}

/**
 * Fetches the private document image as an object URL. The bucket is private, so
 * the bytes are streamed through the ops-authenticated endpoint (httpClient only
 * parses JSON/text, hence the raw fetch here). Caller must revokeObjectURL later.
 */
export const fetchKycDocument = async (kycId: string): Promise<KycDocumentPreview> => {
  const response = await fetch(
    `${API_BASE_URL}/ops/kyc/${encodeURIComponent(kycId)}/document`,
    { headers: await getOpsCredentialHeaders() },
  )

  if (!response.ok) {
    let reason = `Request failed with status ${response.status}`
    try {
      const body = await response.json() as { reason?: string }
      if (body?.reason) reason = body.reason
    }
    catch {
      // response was not JSON; keep the default reason
    }
    throw new Error(reason)
  }

  const blob = await response.blob()
  return {
    contentType: blob.type || 'application/octet-stream',
    objectUrl: URL.createObjectURL(blob),
  }
}
