import type { OpsMutationDetails } from './opsMutationTypes'

import { adminRequest, unwrapAdminResult } from './adminRequest'
import {
  OpsIntegration,
  OpsIntegrationCatalog,
  OpsIntegrationInput,
  OpsRunbook,
  OpsRunbookInput,
} from './integrationTypes'

export const getOpsIntegrationCatalog = async (): Promise<OpsIntegrationCatalog> => {
  const result = await adminRequest<OpsIntegrationCatalog>('/ops/integrations', { method: 'GET' })
  return unwrapAdminResult(result)
}

export const createOpsIntegration = async (
  input: OpsIntegrationInput,
  mutation: OpsMutationDetails,
): Promise<OpsIntegration> => {
  const result = await adminRequest<OpsIntegration>('/ops/integrations', {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    mutation,
  })
  return unwrapAdminResult(result)
}

export const updateOpsIntegration = async (
  integrationId: string,
  input: OpsIntegrationInput,
  mutation: OpsMutationDetails,
): Promise<OpsIntegration> => {
  const result = await adminRequest<OpsIntegration>(`/ops/integrations/${encodeURIComponent(integrationId)}`, {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
    mutation,
  })
  return unwrapAdminResult(result)
}

export const createOpsRunbook = async (
  input: OpsRunbookInput,
  mutation: OpsMutationDetails,
): Promise<OpsRunbook> => {
  const result = await adminRequest<OpsRunbook>('/ops/integrations/runbooks', {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    mutation,
  })
  return unwrapAdminResult(result)
}

export const updateOpsRunbook = async (
  runbookId: string,
  input: OpsRunbookInput,
  mutation: OpsMutationDetails,
): Promise<OpsRunbook> => {
  const result = await adminRequest<OpsRunbook>(`/ops/integrations/runbooks/${encodeURIComponent(runbookId)}`, {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'PATCH',
    mutation,
  })
  return unwrapAdminResult(result)
}
