import type { ApiResult } from '../http/types'
import type {
  PartnerAiAccountMetadata,
  PartnerAiAuthorizationRequest,
  PartnerAiAuthorizationResolution,
  PartnerAiConnection,
  PartnerAiProductEventInput,
  PartnerApiKeyScope,
  PartnerPixReceipt,
  PartnerPortalApiKeyList,
  PartnerPortalApiKeySecretResult,
  PartnerPortalApiKeySummary,
  PartnerPortalAuditEvent,
  PartnerPortalLoginResult,
  PartnerPortalMfaConfirmation,
  PartnerPortalMfaEnrollment,
  PartnerPortalResetToken,
  PartnerPortalRole,
  PartnerPortalSession,
  PartnerPortalSignupAcknowledgement,
  PartnerPortalSignupChallenge,
  PartnerPortalSignupInput,
  PartnerPortalUser,
  PartnerPortalWebhookConfiguration,
  PartnerPortalWebhookSecretResult,
  PartnerPortalWebhookTestResult,
  PartnerReconciliationRun,
  PartnerTransactionDetail,
  PartnerTransactionFilters,
  PartnerTransactionListResponse,
  PartnerWebhookRedeliveryResult,
} from './partnerPortalTypes'

import { HttpClient } from '../http/httpClient'
import { clearPartnerPortalSession, getPartnerPortalToken } from './partnerPortalSessionStore'

type ApiErrorBody = { code?: string, reason?: string }

const bootstrapClient = new HttpClient({ getAuthToken: () => null })
const portalClient = new HttpClient({ getAuthToken: getPartnerPortalToken })

const errorMessage = (result: ApiResult<unknown, ApiErrorBody>): string => {
  if (result.ok) return ''
  const reason = result.error.body?.reason
  if (typeof reason === 'string' && reason.trim()) return reason
  if (result.status === 401) return 'Your session is no longer valid. Sign in again.'
  return result.error.message || 'Request failed'
}

const unwrap = <TData>(result: ApiResult<TData, ApiErrorBody>): TData => {
  if (result.ok) return result.data
  if (result.status === 401) clearPartnerPortalSession()
  throw new Error(errorMessage(result))
}

const queryFromFilters = (filters: PartnerTransactionFilters) => ({
  createdFrom: filters.createdFrom,
  createdTo: filters.createdTo,
  page: filters.page,
  pageSize: filters.pageSize,
  query: filters.query,
  status: filters.status,
})

const jsonRequest = (method: 'PATCH' | 'POST' | 'PUT', body?: unknown) => ({
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  headers: { 'Content-Type': 'application/json' },
  method,
})

export const approvePartnerAiAuthorization = async (
  requestId: string,
): Promise<PartnerAiAuthorizationResolution> => {
  const result = await portalClient.request<PartnerAiAuthorizationResolution, ApiErrorBody>(
    `/partner-portal/ai/authorization-requests/${encodeURIComponent(requestId)}/approval`,
    jsonRequest('POST'),
  )
  return unwrap(result)
}

export const denyPartnerAiAuthorization = async (
  requestId: string,
): Promise<PartnerAiAuthorizationResolution> => {
  const result = await portalClient.request<PartnerAiAuthorizationResolution, ApiErrorBody>(
    `/partner-portal/ai/authorization-requests/${encodeURIComponent(requestId)}/denial`,
    jsonRequest('POST'),
  )
  return unwrap(result)
}

export const getPartnerAiAuthorizationRequest = async (
  requestId: string,
): Promise<PartnerAiAuthorizationRequest> => {
  const result = await portalClient.request<PartnerAiAuthorizationRequest, ApiErrorBody>(
    `/partner-portal/ai/authorization-requests/${encodeURIComponent(requestId)}`,
    { method: 'GET' },
  )
  return unwrap(result)
}

export const listPartnerAiConnections = async (): Promise<PartnerAiConnection[]> => {
  const result = await portalClient.request<{ items: PartnerAiConnection[] }, ApiErrorBody>(
    '/partner-portal/ai/connections',
    { method: 'GET' },
  )
  return unwrap(result).items
}

export const recordPartnerAiProductEvent = async (
  input: PartnerAiProductEventInput,
): Promise<void> => {
  const result = await portalClient.request<void, ApiErrorBody>(
    '/partner-portal/ai/product-events',
    jsonRequest('POST', input),
  )
  unwrap(result)
}

export const revokePartnerAiConnection = async (
  connectionId: string,
): Promise<PartnerAiConnection> => {
  const result = await portalClient.request<PartnerAiConnection, ApiErrorBody>(
    `/partner-portal/ai/connections/${encodeURIComponent(connectionId)}`,
    { method: 'DELETE' },
  )
  return unwrap(result)
}

export const testPartnerAiConnection = async (
  connectionId: string,
): Promise<PartnerAiAccountMetadata> => {
  const result = await portalClient.request<PartnerAiAccountMetadata, ApiErrorBody>(
    `/partner-portal/ai/connections/${encodeURIComponent(connectionId)}/test`,
    jsonRequest('POST'),
  )
  return unwrap(result)
}

export const activatePartnerWebhook = async (): Promise<PartnerPortalWebhookConfiguration> => {
  const result = await portalClient.request<PartnerPortalWebhookConfiguration, ApiErrorBody>(
    '/partner-portal/integration/webhook/activation',
    jsonRequest('POST'),
  )
  return unwrap(result)
}

export const beginPartnerMfaEnrollment = async (
  currentPassword: string,
): Promise<PartnerPortalMfaEnrollment> => {
  const result = await portalClient.request<PartnerPortalMfaEnrollment, ApiErrorBody>(
    '/partner-portal/security/mfa/enrollment',
    jsonRequest('POST', { currentPassword }),
  )
  return unwrap(result)
}

export const changePartnerPortalPassword = async (
  currentPassword: string,
  newPassword: string,
): Promise<void> => {
  const result = await portalClient.request<void, ApiErrorBody>(
    '/partner-portal/security/password',
    jsonRequest('PATCH', { currentPassword, newPassword }),
  )
  unwrap(result)
}

export const completePartnerMfaChallenge = async (
  challengeToken: string,
  code: string,
): Promise<PartnerPortalSession> => {
  const result = await bootstrapClient.request<PartnerPortalSession, ApiErrorBody>(
    '/partner-portal/session/mfa',
    jsonRequest('POST', { challengeToken, code }),
  )
  return unwrap(result)
}

export const confirmPartnerMfaEnrollment = async (
  code: string,
): Promise<PartnerPortalMfaConfirmation> => {
  const result = await portalClient.request<PartnerPortalMfaConfirmation, ApiErrorBody>(
    '/partner-portal/security/mfa/confirmation',
    jsonRequest('POST', { code }),
  )
  return unwrap(result)
}

export const continuePartnerPixReconciliation = async (
  runId: string,
): Promise<PartnerReconciliationRun> => {
  const result = await portalClient.request<PartnerReconciliationRun, ApiErrorBody>(
    `/partner-portal/reconciliation-runs/${encodeURIComponent(runId)}/continue`,
    jsonRequest('POST'),
  )
  return unwrap(result)
}

export const createPartnerApiKey = async (input: {
  expiresAt?: string
  name: string
  scopes: PartnerApiKeyScope[]
}): Promise<PartnerPortalApiKeySecretResult> => {
  const result = await portalClient.request<PartnerPortalApiKeySecretResult, ApiErrorBody>(
    '/partner-portal/integration/api-keys',
    jsonRequest('POST', input),
  )
  return unwrap(result)
}

export const createPartnerPortalSession = async (
  email: string,
  password: string,
): Promise<PartnerPortalLoginResult> => {
  const result = await bootstrapClient.request<PartnerPortalLoginResult, ApiErrorBody>(
    '/partner-portal/session',
    jsonRequest('POST', {
      email: email.trim().toLowerCase(),
      password,
    }),
  )
  return unwrap(result)
}

export const createPartnerPortalSignup = async (
  input: PartnerPortalSignupInput,
  idempotencyKey: string,
): Promise<PartnerPortalSignupAcknowledgement> => {
  const result = await bootstrapClient.request<PartnerPortalSignupAcknowledgement, ApiErrorBody>(
    '/partner-portal/signup',
    {
      body: JSON.stringify(input),
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      method: 'POST',
    },
  )
  return unwrap(result)
}

export const createPartnerPortalSignupChallenge = async (): Promise<PartnerPortalSignupChallenge> => {
  const result = await bootstrapClient.request<PartnerPortalSignupChallenge, ApiErrorBody>(
    '/partner-portal/signup/challenge',
    jsonRequest('POST'),
  )
  return unwrap(result)
}

export const createPartnerPortalUser = async (
  email: string,
  role: PartnerPortalRole,
): Promise<PartnerPortalResetToken> => {
  const result = await portalClient.request<PartnerPortalResetToken, ApiErrorBody>(
    '/partner-portal/team',
    jsonRequest('POST', { email, role }),
  )
  return unwrap(result)
}

export const discardPartnerWebhookDraft = async (): Promise<PartnerPortalWebhookConfiguration> => {
  const result = await portalClient.request<PartnerPortalWebhookConfiguration, ApiErrorBody>(
    '/partner-portal/integration/webhook/draft',
    { method: 'DELETE' },
  )
  return unwrap(result)
}

export const getPartnerPixReceipt = async (
  transactionId: string,
  lang: 'en' | 'pt-BR' = 'pt-BR',
): Promise<PartnerPixReceipt> => {
  const result = await portalClient.request<PartnerPixReceipt, ApiErrorBody>(
    `/partner-portal/transactions/${encodeURIComponent(transactionId)}/receipt`,
    { method: 'GET', query: { lang } },
  )
  return unwrap(result)
}

export const getPartnerWebhookConfiguration = async (): Promise<PartnerPortalWebhookConfiguration> => {
  const result = await portalClient.request<PartnerPortalWebhookConfiguration, ApiErrorBody>(
    '/partner-portal/integration/webhook',
    { method: 'GET' },
  )
  return unwrap(result)
}

export const issuePartnerPasswordReset = async (
  userId: string,
): Promise<PartnerPortalResetToken> => {
  const result = await portalClient.request<PartnerPortalResetToken, ApiErrorBody>(
    `/partner-portal/team/${encodeURIComponent(userId)}/password-reset`,
    jsonRequest('POST'),
  )
  return unwrap(result)
}

export const listPartnerApiKeys = async (): Promise<PartnerPortalApiKeyList> => {
  const result = await portalClient.request<PartnerPortalApiKeyList, ApiErrorBody>(
    '/partner-portal/integration/api-keys',
    { method: 'GET' },
  )
  return unwrap(result)
}

export const listPartnerAuditEvents = async (): Promise<PartnerPortalAuditEvent[]> => {
  const result = await portalClient.request<PartnerPortalAuditEvent[], ApiErrorBody>(
    '/partner-portal/team/audit-events',
    { method: 'GET' },
  )
  return unwrap(result)
}

export const listPartnerPixReconciliations = async (): Promise<PartnerReconciliationRun[]> => {
  const result = await portalClient.request<{ items: PartnerReconciliationRun[] }, ApiErrorBody>(
    '/partner-portal/reconciliation-runs',
    { method: 'GET' },
  )
  return unwrap(result).items
}

export const listPartnerPortalUsers = async (): Promise<PartnerPortalUser[]> => {
  const result = await portalClient.request<PartnerPortalUser[], ApiErrorBody>(
    '/partner-portal/team',
    { method: 'GET' },
  )
  return unwrap(result)
}

export const redeliverPartnerWebhook = async (
  transactionId: string,
  deliveryId: string,
  idempotencyKey: string,
): Promise<PartnerWebhookRedeliveryResult> => {
  const result = await portalClient.request<PartnerWebhookRedeliveryResult, ApiErrorBody>(
    `/partner-portal/transactions/${encodeURIComponent(transactionId)}/deliveries/${encodeURIComponent(deliveryId)}/redelivery`,
    {
      headers: { 'Idempotency-Key': idempotencyKey },
      method: 'POST',
    },
  )
  return unwrap(result)
}

export const regeneratePartnerRecoveryCodes = async (
  currentPassword: string,
): Promise<string[]> => {
  const result = await portalClient.request<{ recoveryCodes: string[] }, ApiErrorBody>(
    '/partner-portal/security/mfa/recovery-codes',
    jsonRequest('POST', { currentPassword }),
  )
  return unwrap(result).recoveryCodes
}

export const resetPartnerMfa = async (userId: string): Promise<PartnerPortalUser> => {
  const result = await portalClient.request<PartnerPortalUser, ApiErrorBody>(
    `/partner-portal/team/${encodeURIComponent(userId)}/mfa-reset`,
    jsonRequest('POST'),
  )
  return unwrap(result)
}

export const resetPartnerPasswordWithRecoveryCode = async (input: {
  email: string
  newPassword: string
  recoveryCode: string
}): Promise<void> => {
  const result = await bootstrapClient.request<void, ApiErrorBody>(
    '/partner-portal/session/password/recovery',
    jsonRequest('POST', input),
  )
  unwrap(result)
}

export const resetPartnerPasswordWithToken = async (
  token: string,
  newPassword: string,
): Promise<void> => {
  const result = await bootstrapClient.request<void, ApiErrorBody>(
    '/partner-portal/session/password/reset',
    jsonRequest('POST', { newPassword, token }),
  )
  unwrap(result)
}

export const revokePartnerApiKey = async (
  apiKeyId: string,
): Promise<PartnerPortalApiKeySummary> => {
  const result = await portalClient.request<PartnerPortalApiKeySummary, ApiErrorBody>(
    `/partner-portal/integration/api-keys/${encodeURIComponent(apiKeyId)}`,
    { method: 'DELETE' },
  )
  return unwrap(result)
}

export const rotatePartnerApiKey = async (
  apiKeyId: string,
): Promise<PartnerPortalApiKeySecretResult> => {
  const result = await portalClient.request<PartnerPortalApiKeySecretResult, ApiErrorBody>(
    `/partner-portal/integration/api-keys/${encodeURIComponent(apiKeyId)}/rotation`,
    jsonRequest('POST'),
  )
  return unwrap(result)
}

export const rotatePartnerWebhookSecret = async (): Promise<PartnerPortalWebhookSecretResult> => {
  const result = await portalClient.request<PartnerPortalWebhookSecretResult, ApiErrorBody>(
    '/partner-portal/integration/webhook/secret-rotation',
    jsonRequest('POST'),
  )
  return unwrap(result)
}

export const stagePartnerWebhookUrl = async (
  url: string,
): Promise<PartnerPortalWebhookConfiguration> => {
  const result = await portalClient.request<PartnerPortalWebhookConfiguration, ApiErrorBody>(
    '/partner-portal/integration/webhook/draft',
    jsonRequest('PUT', { url }),
  )
  return unwrap(result)
}

export const startPartnerPixReconciliation = async (
  batchSize = 5,
): Promise<PartnerReconciliationRun> => {
  const result = await portalClient.request<PartnerReconciliationRun, ApiErrorBody>(
    '/partner-portal/reconciliation-runs',
    jsonRequest('POST', { batchSize }),
  )
  return unwrap(result)
}

export const testPartnerWebhookDraft = async (): Promise<PartnerPortalWebhookTestResult> => {
  const result = await portalClient.request<PartnerPortalWebhookTestResult, ApiErrorBody>(
    '/partner-portal/integration/webhook/test',
    jsonRequest('POST'),
  )
  return unwrap(result)
}

export const updatePartnerPortalUser = async (
  userId: string,
  input: { disabled?: boolean, role?: PartnerPortalRole },
): Promise<PartnerPortalUser> => {
  const result = await portalClient.request<PartnerPortalUser, ApiErrorBody>(
    `/partner-portal/team/${encodeURIComponent(userId)}`,
    jsonRequest('PATCH', input),
  )
  return unwrap(result)
}

export const verifyPartnerPortalSignupEmail = async (
  token: string,
): Promise<PartnerPortalSession> => {
  const result = await bootstrapClient.request<PartnerPortalSession, ApiErrorBody>(
    '/partner-portal/signup/email-verification',
    jsonRequest('POST', { token }),
  )
  return unwrap(result)
}

export const exportPartnerTransactions = async (
  filters: PartnerTransactionFilters,
): Promise<string> => {
  const result = await portalClient.request<string, ApiErrorBody>(
    '/partner-portal/transactions/export.csv',
    {
      method: 'GET',
      query: queryFromFilters(filters),
    },
  )
  return unwrap(result)
}

export const getPartnerTransaction = async (
  transactionId: string,
  signal?: AbortSignal,
): Promise<PartnerTransactionDetail> => {
  const result = await portalClient.request<PartnerTransactionDetail, ApiErrorBody>(
    `/partner-portal/transactions/${encodeURIComponent(transactionId)}`,
    { method: 'GET', signal },
  )
  return unwrap(result)
}

export const listPartnerTransactions = async (
  filters: PartnerTransactionFilters,
  signal?: AbortSignal,
): Promise<PartnerTransactionListResponse> => {
  const result = await portalClient.request<PartnerTransactionListResponse, ApiErrorBody>(
    '/partner-portal/transactions',
    {
      method: 'GET',
      query: queryFromFilters(filters),
      signal,
    },
  )
  return unwrap(result)
}
