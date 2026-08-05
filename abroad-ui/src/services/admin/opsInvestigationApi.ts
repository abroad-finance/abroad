import type { OpsMutationDetails } from './opsMutationTypes'

import { adminRequest, unwrapAdminResult } from './adminRequest'
import {
  OpsCase,
  OpsCaseCreateInput,
  OpsCaseHandoffInput,
  OpsCaseUpdateInput,
  OpsGlobalSearchResponse,
  OpsSavedView,
  OpsSavedViewFilters,
  OpsSavedViewResource,
} from './opsInvestigationTypes'
import { OpsCaseUser } from './transactionAdminTypes'

export const globalOpsSearch = async (
  query: string,
  signal?: AbortSignal,
): Promise<OpsGlobalSearchResponse> => {
  const result = await adminRequest<OpsGlobalSearchResponse>('/ops/search', {
    method: 'GET',
    query: { query },
    signal,
  })
  return unwrapAdminResult(result)
}

export const listOpsCaseOwners = async (): Promise<OpsCaseUser[]> => {
  const result = await adminRequest<OpsCaseUser[]>('/ops/cases/owner-options', { method: 'GET' })
  return unwrapAdminResult(result)
}

export const createOpsCase = async (
  input: OpsCaseCreateInput,
  mutation: OpsMutationDetails,
): Promise<OpsCase> => {
  const result = await adminRequest<OpsCase>('/ops/cases', {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    mutation,
  })
  return unwrapAdminResult(result)
}

export const updateOpsCase = async (
  caseId: string,
  input: OpsCaseUpdateInput,
  mutation: OpsMutationDetails,
): Promise<OpsCase> => {
  const result = await adminRequest<OpsCase>(`/ops/cases/${encodeURIComponent(caseId)}`, {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
    mutation,
  })
  return unwrapAdminResult(result)
}

export const addOpsCaseNote = async (
  caseId: string,
  input: { body: string, kind: 'ESCALATION' | 'NOTE' | 'RESOLUTION' },
  mutation: OpsMutationDetails,
): Promise<OpsCase> => {
  const result = await adminRequest<OpsCase>(`/ops/cases/${encodeURIComponent(caseId)}/notes`, {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    mutation,
  })
  return unwrapAdminResult(result)
}

export const handoffOpsCase = async (
  caseId: string,
  input: OpsCaseHandoffInput,
  mutation: OpsMutationDetails,
): Promise<OpsCase> => {
  const result = await adminRequest<OpsCase>(`/ops/cases/${encodeURIComponent(caseId)}/handoffs`, {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    mutation,
  })
  return unwrapAdminResult(result)
}

export const listOpsSavedViews = async (
  resource: OpsSavedViewResource,
): Promise<OpsSavedView[]> => {
  const result = await adminRequest<OpsSavedView[]>('/ops/saved-views', {
    method: 'GET',
    query: { resource },
  })
  return unwrapAdminResult(result)
}

export const createOpsSavedView = async (
  input: {
    filters: OpsSavedViewFilters
    name: string
    resource: OpsSavedViewResource
    scope: 'PRIVATE' | 'TEAM'
  },
  mutation: OpsMutationDetails,
): Promise<OpsSavedView> => {
  const result = await adminRequest<OpsSavedView>('/ops/saved-views', {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    mutation,
  })
  return unwrapAdminResult(result)
}

export const updateOpsSavedView = async (
  viewId: string,
  input: { filters?: OpsSavedViewFilters, name?: string, scope?: 'PRIVATE' | 'TEAM' },
  mutation: OpsMutationDetails,
): Promise<OpsSavedView> => {
  const result = await adminRequest<OpsSavedView>(`/ops/saved-views/${encodeURIComponent(viewId)}`, {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
    mutation,
  })
  return unwrapAdminResult(result)
}

export const deleteOpsSavedView = async (
  viewId: string,
  mutation: OpsMutationDetails,
): Promise<{ id: string }> => {
  const result = await adminRequest<{ id: string }>(`/ops/saved-views/${encodeURIComponent(viewId)}`, {
    method: 'DELETE',
    mutation,
  })
  return unwrapAdminResult(result)
}
