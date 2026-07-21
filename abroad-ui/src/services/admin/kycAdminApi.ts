import type { OpsKycListResponse, OpsKycStatus, OpsKycUserState } from './kycAdminTypes'

import { adminRequest, unwrapAdminResult } from './adminRequest'
import { getOpsApiKey } from './opsAuthStore'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://api.abroad.finance'

export const listKycSubmissions = async (params: {
  page?: number
  pageSize?: number
  status?: '' | OpsKycStatus
} = {}): Promise<OpsKycListResponse> => {
  const result = await adminRequest<OpsKycListResponse>('/ops/kyc', {
    method: 'GET',
    query: {
      page: params.page,
      pageSize: params.pageSize,
      status: params.status || undefined,
    },
  })

  return unwrapAdminResult(result)
}

export const disableKycUser = async (
  partnerUserId: string,
  reason?: string,
): Promise<OpsKycUserState> => {
  const result = await adminRequest<OpsKycUserState>(
    `/ops/kyc/users/${encodeURIComponent(partnerUserId)}/disable`,
    {
      body: JSON.stringify(reason ? { reason } : {}),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  )

  return unwrapAdminResult(result)
}

export const enableKycUser = async (partnerUserId: string): Promise<OpsKycUserState> => {
  const result = await adminRequest<OpsKycUserState>(
    `/ops/kyc/users/${encodeURIComponent(partnerUserId)}/enable`,
    { method: 'POST' },
  )

  return unwrapAdminResult(result)
}

export const rejectKyc = async (kycId: string): Promise<void> => {
  const result = await adminRequest<{ id: string, status: OpsKycStatus }>(
    `/ops/kyc/${encodeURIComponent(kycId)}/reject`,
    { method: 'POST' },
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
  const opsApiKey = getOpsApiKey()
  if (!opsApiKey) {
    throw new Error('Ops API key is required')
  }

  const response = await fetch(
    `${API_BASE_URL}/ops/kyc/${encodeURIComponent(kycId)}/document`,
    { headers: { 'X-OPS-API-KEY': opsApiKey } },
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
