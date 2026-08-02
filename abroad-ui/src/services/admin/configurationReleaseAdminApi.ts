import type {
  OpsConfigurationDraftInput,
  OpsConfigurationRelease,
  OpsConfigurationReleaseList,
  OpsConfigurationReleaseStatus,
  OpsConfigurationTargetType,
} from './configurationReleaseTypes'
import type { OpsMutationDetails } from './opsMutationTypes'

import { adminRequest, unwrapAdminResult } from './adminRequest'

export type OpsConfigurationReleaseFilters = {
  page?: number
  pageSize?: number
  query?: string
  status?: OpsConfigurationReleaseStatus
  targetType?: OpsConfigurationTargetType
}

export const listOpsConfigurationReleases = async (
  filters: OpsConfigurationReleaseFilters,
): Promise<OpsConfigurationReleaseList> => {
  const result = await adminRequest<OpsConfigurationReleaseList>('/ops/configuration-releases', {
    method: 'GET',
    query: filters,
  })
  return unwrapAdminResult(result)
}

export const getOpsConfigurationRelease = async (
  releaseId: string,
): Promise<OpsConfigurationRelease> => {
  const result = await adminRequest<OpsConfigurationRelease>(
    `/ops/configuration-releases/${encodeURIComponent(releaseId)}`,
    { method: 'GET' },
  )
  return unwrapAdminResult(result)
}

export const createOpsConfigurationRelease = async (
  input: OpsConfigurationDraftInput,
  mutation: OpsMutationDetails,
): Promise<OpsConfigurationRelease> => {
  const result = await adminRequest<OpsConfigurationRelease>('/ops/configuration-releases', {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    mutation,
  })
  return unwrapAdminResult(result)
}

export const updateOpsConfigurationRelease = async (
  releaseId: string,
  input: OpsConfigurationDraftInput,
  mutation: OpsMutationDetails,
): Promise<OpsConfigurationRelease> => {
  const result = await adminRequest<OpsConfigurationRelease>(
    `/ops/configuration-releases/${encodeURIComponent(releaseId)}`,
    {
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
      mutation,
    },
  )
  return unwrapAdminResult(result)
}

const configurationReleaseAction = async (
  releaseId: string,
  action: 'approve' | 'rollback' | 'submit',
  mutation: OpsMutationDetails,
): Promise<OpsConfigurationRelease> => {
  const result = await adminRequest<OpsConfigurationRelease>(
    `/ops/configuration-releases/${encodeURIComponent(releaseId)}/${action}`,
    { method: 'POST', mutation },
  )
  return unwrapAdminResult(result)
}

export const submitOpsConfigurationRelease = async (
  releaseId: string,
  mutation: OpsMutationDetails,
): Promise<OpsConfigurationRelease> => configurationReleaseAction(releaseId, 'submit', mutation)

export const approveOpsConfigurationRelease = async (
  releaseId: string,
  mutation: OpsMutationDetails,
): Promise<OpsConfigurationRelease> => configurationReleaseAction(releaseId, 'approve', mutation)

export const createOpsConfigurationRollback = async (
  releaseId: string,
  mutation: OpsMutationDetails,
): Promise<OpsConfigurationRelease> => configurationReleaseAction(releaseId, 'rollback', mutation)

export const rejectOpsConfigurationRelease = async (
  releaseId: string,
  rejectionReason: string,
  mutation: OpsMutationDetails,
): Promise<OpsConfigurationRelease> => {
  const result = await adminRequest<OpsConfigurationRelease>(
    `/ops/configuration-releases/${encodeURIComponent(releaseId)}/reject`,
    {
      body: JSON.stringify({ rejectionReason }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      mutation,
    },
  )
  return unwrapAdminResult(result)
}
