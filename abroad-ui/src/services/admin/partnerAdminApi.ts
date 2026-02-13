import type {
  OpsCreatePartnerInput,
  OpsCreatePartnerResponse,
  OpsPartnerListResponse,
  OpsRotatePartnerApiKeyResponse,
} from './partnerTypes'

import { adminRequest, unwrapAdminResult } from './adminRequest'

export const listPartners = async (params: {
  page?: number
  pageSize?: number
} = {}): Promise<OpsPartnerListResponse> => {
  const result = await adminRequest<OpsPartnerListResponse>('/ops/partners', {
    method: 'GET',
    query: {
      page: params.page,
      pageSize: params.pageSize,
    },
  })

  return unwrapAdminResult(result)
}

export const createPartner = async (payload: OpsCreatePartnerInput): Promise<OpsCreatePartnerResponse> => {
  const result = await adminRequest<OpsCreatePartnerResponse>('/ops/partners', {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  })

  return unwrapAdminResult(result)
}

export const rotatePartnerApiKey = async (partnerId: string): Promise<OpsRotatePartnerApiKeyResponse> => {
  const result = await adminRequest<OpsRotatePartnerApiKeyResponse>(`/ops/partners/${partnerId}/api-key`, {
    method: 'POST',
  })

  return unwrapAdminResult(result)
}

export const revokePartnerApiKey = async (partnerId: string): Promise<void> => {
  const result = await adminRequest<null>(`/ops/partners/${partnerId}/api-key`, {
    method: 'DELETE',
  })

  unwrapAdminResult(result)
}
