import type { OpsMutationDetails } from './opsMutationTypes'
import type {
  OpsCreatePartnerInput,
  OpsCreatePartnerResponse,
  OpsPartnerCredentialHistory,
  OpsPartnerListResponse,
  OpsRotatePartnerApiKeyResponse,
  OpsUpdatePartnerClientDomainInput,
  OpsUpdatePartnerClientDomainResponse,
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

export const getPartnerCredentialHistory = async (
  partnerId: string,
): Promise<OpsPartnerCredentialHistory> => {
  const result = await adminRequest<OpsPartnerCredentialHistory>(
    `/ops/partners/${partnerId}/credential-history`,
    { method: 'GET' },
  )

  return unwrapAdminResult(result)
}

export const createPartner = async (
  payload: OpsCreatePartnerInput,
  mutation: OpsMutationDetails,
): Promise<OpsCreatePartnerResponse> => {
  const result = await adminRequest<OpsCreatePartnerResponse>('/ops/partners', {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    mutation,
  })

  return unwrapAdminResult(result)
}

export const rotatePartnerApiKey = async (
  partnerId: string,
  mutation: OpsMutationDetails,
): Promise<OpsRotatePartnerApiKeyResponse> => {
  const result = await adminRequest<OpsRotatePartnerApiKeyResponse>(`/ops/partners/${partnerId}/api-key`, {
    method: 'POST',
    mutation,
  })

  return unwrapAdminResult(result)
}

export const revokePartnerApiKey = async (
  partnerId: string,
  mutation: OpsMutationDetails,
): Promise<void> => {
  const result = await adminRequest<null>(`/ops/partners/${partnerId}/api-key`, {
    method: 'DELETE',
    mutation,
  })

  unwrapAdminResult(result)
}

export const updatePartnerClientDomain = async (
  partnerId: string,
  payload: OpsUpdatePartnerClientDomainInput,
  mutation: OpsMutationDetails,
): Promise<OpsUpdatePartnerClientDomainResponse> => {
  const result = await adminRequest<OpsUpdatePartnerClientDomainResponse>(
    `/ops/partners/${partnerId}/client-domain`,
    {
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
      mutation,
    },
  )

  return unwrapAdminResult(result)
}
