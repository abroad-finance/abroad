export const partnerTransactionStatuses = [
  'AWAITING_PAYMENT',
  'PROCESSING_PAYMENT',
  'PAYMENT_FAILED',
  'PAYMENT_EXPIRED',
  'PAYMENT_COMPLETED',
  'WRONG_AMOUNT',
] as const

export const partnerApiKeyScopes = [
  'transactions:read',
  'transactions:write',
  'partner-users:read',
  'partner-users:write',
  'kyc:read',
  'kyc:write',
  'telemetry:write',
] as const

export type PartnerApiKeyScope = typeof partnerApiKeyScopes[number]

export type PartnerPixReceipt = {
  contentBase64: string
  contentType: 'application/pdf'
  fileName: string
  sizeBytes: number
}

export type PartnerPortalApiKeyList = {
  items: PartnerPortalApiKeySummary[]
  legacyKeyActive: boolean
}

export type PartnerPortalApiKeySecretResult = {
  apiKey: PartnerPortalApiKeySummary
  secret: string
}

export type PartnerPortalApiKeySummary = {
  createdAt: string
  displayPrefix: string
  expiresAt: null | string
  id: string
  lastUsedAt: null | string
  name: string
  revokedAt: null | string
  scopes: PartnerApiKeyScope[]
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED'
}

export type PartnerPortalAuditEvent = {
  action: string
  actorEmail: null | string
  createdAt: string
  id: string
  resourceId: null | string
  resourceType: string
}

export type PartnerPortalLoginResult
  = | {
    challenge: PartnerPortalMfaChallenge
    status: 'MFA_REQUIRED'
  }
  | {
    session: PartnerPortalSession
    status: 'AUTHENTICATED'
  }

export type PartnerPortalMfaChallenge = {
  challengeToken: string
  expiresAt: string
}

export type PartnerPortalMfaConfirmation = {
  recoveryCodes: string[]
  session: PartnerPortalSession
}

export type PartnerPortalMfaEnrollment = {
  expiresAt: string
  manualEntryKey: string
  otpauthUri: string
}

export type PartnerPortalResetToken = {
  expiresAt: string
  purpose: 'INVITATION' | 'PASSWORD_RESET'
  token: string
  user: PartnerPortalUser
}

export type PartnerPortalRole = 'ADMIN' | 'MEMBER'

export type PartnerPortalSession = {
  accessToken: string
  email: string
  expiresAt: string
  mfaEnabled: boolean
  mfaVerified: boolean
  partnerName: string
  role: PartnerPortalRole
  userId: string
}

export type PartnerPortalUser = {
  createdAt: string
  disabledAt: null | string
  email: string
  id: string
  lastLoginAt: null | string
  mfaEnabled: boolean
  role: PartnerPortalRole
}

export type PartnerPortalWebhookConfiguration = {
  active: {
    managedSecret: boolean
    secretPrefix: null | string
    url: null | string
    version: number
  }
  pending: null | {
    lastTest: null | PartnerPortalWebhookTestResult
    revision: number
    rotatesSecret: boolean
    secretPrefix: null | string
    url: string
  }
}

export type PartnerPortalWebhookSecretResult = {
  configuration: PartnerPortalWebhookConfiguration
  secret: string
}

export type PartnerPortalWebhookTestResult = {
  attemptedAt: string
  deliveryId: null | string
  durationMs: null | number
  failureCode: null | string
  httpStatus: null | number
  status: PartnerWebhookDeliveryStatus
}

export type PartnerReconciliationItem = {
  failureCode: null | string
  status: 'FAILED' | 'INELIGIBLE' | 'UNCHANGED' | 'UPDATED'
  transactionId: string
  updatedAt: string
}

export type PartnerReconciliationRun = {
  batchSize: number
  completedAt: null | string
  createdAt: string
  failureCount: number
  id: string
  ineligibleCount: number
  items: PartnerReconciliationItem[]
  processedCount: number
  status: 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'RUNNING'
  unchangedCount: number
  updatedAt: string
  updatedCount: number
}

export type PartnerTransactionDelivery = {
  attempts: number
  canRedeliver: boolean
  durationMs: null | number
  event: 'transaction.created' | 'transaction.updated' | 'unknown'
  failureCode: null | string
  httpStatus: null | number
  id: string
  lastAttemptAt: string
  nextAttemptAt: null | string
  purpose: 'REDELIVERY' | 'TEST' | 'TRANSACTION'
  sourceDeliveryId: null | string
  status: PartnerWebhookDeliveryStatus
}

export type PartnerTransactionDetail = PartnerTransactionSummary & {
  deliveries: PartnerTransactionDelivery[]
  failureReason: null | string
  lifecycle: PartnerTransactionLifecycle[]
  payoutDestinationHint: null | string
  pixEndToEndId: null | string
  refund: null | PartnerTransactionRefund
}

export type PartnerTransactionFilters = {
  createdFrom?: string
  createdTo?: string
  page?: number
  pageSize?: number
  query?: string
  status?: PartnerTransactionStatus
}

export type PartnerTransactionLifecycle = {
  occurredAt: string
  status: PartnerTransactionStatus
  type: 'CREATED' | 'STATUS_CHANGED'
}

export type PartnerTransactionListResponse = {
  items: PartnerTransactionSummary[]
  page: number
  pageSize: number
  statusCounts: PartnerTransactionStatusCount[]
  total: number
}

export type PartnerTransactionQuote = {
  country: string
  cryptoCurrency: string
  network: string
  paymentMethod: string
  sourceAmount: number
  targetAmount: number
  targetCurrency: string
}

export type PartnerTransactionRefund = {
  onChainId: null | string
  status: 'COMPLETED' | 'FAILED' | 'NOT_STARTED' | 'PROCESSING'
}

export type PartnerTransactionStatus = typeof partnerTransactionStatuses[number]

export type PartnerTransactionStatusCount = {
  count: number
  status: PartnerTransactionStatus
}

export type PartnerTransactionSummary = {
  createdAt: string
  id: string
  onChainId: null | string
  quote: PartnerTransactionQuote
  status: PartnerTransactionStatus
  userReference: string
}

export type PartnerWebhookDeliveryStatus = 'DELIVERED' | 'DELIVERING' | 'FAILED' | 'PENDING'

export type PartnerWebhookRedeliveryResult = {
  alreadyExisted: boolean
  attempts: number
  deliveryId: string
  durationMs: null | number
  httpStatus: null | number
  status: PartnerWebhookDeliveryStatus
}
