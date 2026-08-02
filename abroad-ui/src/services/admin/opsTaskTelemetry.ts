import type { OpsAdminRequestError } from './adminRequest'

import { adminRequest } from './adminRequest'
import { getOpsSession } from './opsAuthStore'

export type OpsTaskTelemetryInput = {
  action: 'COMPLETED' | 'REQUESTED' | 'RESULT_OPENED' | 'SUBMITTED'
  durationMs?: number
  metadata: {
    entryPoint?: 'CASE' | 'FLOW' | 'INCIDENT' | 'PARTNER' | 'TRANSACTION'
    failureClass?: 'AUTHORIZATION' | 'CONFLICT' | 'NETWORK' | 'PROVIDER' | 'UNKNOWN' | 'VALIDATION'
    viewport: 'DESKTOP' | 'MOBILE' | 'TABLET'
  }
  result: 'ABANDONED' | 'FAILED' | 'SUCCEEDED'
  task: 'GLOBAL_SEARCH' | 'INCIDENT_OWNERSHIP' | 'MUTATION' | 'PROOF_RETRIEVAL'
}

export const getOpsTelemetryViewport = (): OpsTaskTelemetryInput['metadata']['viewport'] => {
  if (window.innerWidth < 640) return 'MOBILE'
  if (window.innerWidth < 1_024) return 'TABLET'
  return 'DESKTOP'
}

export const classifyOpsTelemetryFailure = (
  error: unknown,
): NonNullable<OpsTaskTelemetryInput['metadata']['failureClass']> => {
  if (typeof error !== 'object' || error === null) return 'UNKNOWN'
  const candidate = error as Partial<OpsAdminRequestError>
  if (candidate.status === 401 || candidate.status === 403) return 'AUTHORIZATION'
  if (candidate.status === 409 || candidate.status === 412) return 'CONFLICT'
  if (candidate.status !== null && candidate.status !== undefined && candidate.status >= 400 && candidate.status < 500) {
    return 'VALIDATION'
  }
  if (candidate.status !== null && candidate.status !== undefined && candidate.status >= 500) return 'PROVIDER'
  if (error instanceof TypeError) return 'NETWORK'
  return 'UNKNOWN'
}

export const recordOpsTaskEvent = (input: OpsTaskTelemetryInput): void => {
  if (getOpsSession()?.kind !== 'ops_user') return
  void adminRequest<null>('/ops/task-events', {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }).catch(() => undefined)
}
