import type {
  OpsAuditListResponse,
  OpsAuditSearchFilters,
  OpsUser,
  OpsUserInviteInput,
  OpsUserListResponse,
} from './administrationTypes'
import type { OpsMutationDetails } from './opsMutationTypes'

import { adminRequest, unwrapAdminResult } from './adminRequest'

export const disableOpsUser = async (
  userId: string,
  mutation: OpsMutationDetails,
): Promise<OpsUser> => {
  const result = await adminRequest<OpsUser>(`/ops/administration/users/${userId}/disable`, {
    method: 'POST',
    mutation,
  })
  return unwrapAdminResult(result)
}

export const enableOpsUser = async (
  userId: string,
  mutation: OpsMutationDetails,
): Promise<OpsUser> => {
  const result = await adminRequest<OpsUser>(`/ops/administration/users/${userId}/enable`, {
    method: 'POST',
    mutation,
  })
  return unwrapAdminResult(result)
}

export const inviteOpsUser = async (
  payload: OpsUserInviteInput,
  mutation: OpsMutationDetails,
): Promise<OpsUser> => {
  const result = await adminRequest<OpsUser>('/ops/administration/users', {
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    mutation,
  })
  return unwrapAdminResult(result)
}

export const listOpsAuditEvents = async (
  filters: OpsAuditSearchFilters,
): Promise<OpsAuditListResponse> => {
  const result = await adminRequest<OpsAuditListResponse>('/ops/administration/audit', {
    method: 'GET',
    query: filters,
  })
  return unwrapAdminResult(result)
}

export const listOpsUsers = async (): Promise<OpsUserListResponse> => {
  const result = await adminRequest<OpsUserListResponse>('/ops/administration/users', {
    method: 'GET',
  })
  return unwrapAdminResult(result)
}

export const revokeOpsUserSessions = async (
  userId: string,
  mutation: OpsMutationDetails,
): Promise<OpsUser> => {
  const result = await adminRequest<OpsUser>(`/ops/administration/users/${userId}/revoke-sessions`, {
    method: 'POST',
    mutation,
  })
  return unwrapAdminResult(result)
}

export const updateOpsUserRole = async (
  userId: string,
  role: OpsUser['role'],
  mutation: OpsMutationDetails,
): Promise<OpsUser> => {
  const result = await adminRequest<OpsUser>(`/ops/administration/users/${userId}/role`, {
    body: JSON.stringify({ role }),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
    mutation,
  })
  return unwrapAdminResult(result)
}
