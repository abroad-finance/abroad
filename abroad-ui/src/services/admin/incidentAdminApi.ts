import type { OpsMutationDetails } from './opsMutationTypes'

import { adminRequest, unwrapAdminResult } from './adminRequest'
import {
  OpsHandoffBoard,
  OpsHandoffScope,
  OpsIncidentDetail,
  OpsIncidentListResponse,
  OpsIncidentOverview,
  OpsIncidentOwnerOption,
  OpsIncidentRunbook,
  OpsIncidentSeverity,
  OpsNoteKind,
  OpsWorkStatus,
} from './incidentTypes'

export type OpsIncidentFilters = {
  kind?: string
  ownerUserId?: string
  page?: number
  pageSize?: number
  query?: string
  severity?: OpsIncidentSeverity
  status?: OpsWorkStatus
  team?: string
  unowned?: boolean
}

export const listOpsIncidents = async (filters: OpsIncidentFilters): Promise<OpsIncidentListResponse> => {
  const result = await adminRequest<OpsIncidentListResponse>('/ops/incidents', {
    method: 'GET',
    query: filters,
  })
  return unwrapAdminResult(result)
}

export const getOpsIncident = async (incidentId: string): Promise<OpsIncidentDetail> => {
  const result = await adminRequest<OpsIncidentDetail>(`/ops/incidents/${encodeURIComponent(incidentId)}`, {
    method: 'GET',
  })
  return unwrapAdminResult(result)
}

export const getOpsIncidentOverview = async (): Promise<OpsIncidentOverview> => {
  const result = await adminRequest<OpsIncidentOverview>('/ops/incidents/overview', { method: 'GET' })
  return unwrapAdminResult(result)
}

export const getOpsShiftHandoff = async (scope: OpsHandoffScope): Promise<OpsHandoffBoard> => {
  const result = await adminRequest<OpsHandoffBoard>('/ops/incidents/handoff', {
    method: 'GET',
    query: { scope },
  })
  return unwrapAdminResult(result)
}

export const listOpsIncidentOwners = async (): Promise<OpsIncidentOwnerOption[]> => {
  const result = await adminRequest<OpsIncidentOwnerOption[]>('/ops/incidents/owner-options', { method: 'GET' })
  return unwrapAdminResult(result)
}

export const listOpsIncidentRunbooks = async (): Promise<OpsIncidentRunbook[]> => {
  const result = await adminRequest<OpsIncidentRunbook[]>('/ops/incidents/runbooks', { method: 'GET' })
  return unwrapAdminResult(result)
}

export const updateOpsIncident = async (
  incidentId: string,
  input: {
    ownerUserId?: null | string
    runbookId?: null | string
    status?: OpsWorkStatus
    team?: null | string
  },
  mutation: OpsMutationDetails,
): Promise<OpsIncidentDetail> => {
  const result = await adminRequest<OpsIncidentDetail>(`/ops/incidents/${encodeURIComponent(incidentId)}`, {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
    mutation,
  })
  return unwrapAdminResult(result)
}

export const addOpsIncidentNote = async (
  incidentId: string,
  body: string,
  kind: OpsNoteKind,
  mutation: OpsMutationDetails,
): Promise<OpsIncidentDetail> => {
  const result = await adminRequest<OpsIncidentDetail>(`/ops/incidents/${encodeURIComponent(incidentId)}/notes`, {
    body: JSON.stringify({ body, kind }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    mutation,
  })
  return unwrapAdminResult(result)
}

export const handoffOpsIncident = async (
  incidentId: string,
  input: { note: string, toTeam?: null | string, toUserId?: null | string },
  mutation: OpsMutationDetails,
): Promise<OpsIncidentDetail> => {
  const result = await adminRequest<OpsIncidentDetail>(`/ops/incidents/${encodeURIComponent(incidentId)}/handoffs`, {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    mutation,
  })
  return unwrapAdminResult(result)
}
