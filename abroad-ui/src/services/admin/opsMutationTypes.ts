export const opsMutationActions = [
  'administration.user.disable',
  'administration.user.enable',
  'administration.user.invite',
  'administration.user.revoke_sessions',
  'administration.user.role_update',
  'case.create',
  'case.escalate',
  'case.handoff',
  'case.note.add',
  'case.update',
  'incident.escalate',
  'incident.handoff',
  'incident.note.add',
  'incident.update',
  'integration.create',
  'integration.update',
  'configuration.asset.update',
  'configuration.corridor.update',
  'configuration.definition.create',
  'configuration.definition.update',
  'configuration.geo_restriction.update',
  'configuration.release.approve',
  'configuration.release.create',
  'configuration.release.reject',
  'configuration.release.rollback',
  'configuration.release.submit',
  'configuration.release.update',
  'credentials.api_key.revoke',
  'credentials.api_key.rotate',
  'credentials.client_domain.update',
  'credentials.portal_user.upsert',
  'flow.bulk_retry',
  'flow.resume',
  'flow.step.force_retry',
  'flow.step.requeue',
  'flow.step.retry',
  'kyc.submission.assign',
  'kyc.submission.reject',
  'kyc.user.disable',
  'kyc.user.enable',
  'partner.create',
  'partner.kyb_approval.update',
  'partner.kyc_requirement.update',
  'partner.profile.update',
  'partner.status.update',
  'partner.webhook.update',
  'saved_view.create',
  'saved_view.delete',
  'saved_view.update',
  'runbook.create',
  'runbook.update',
  'transaction.reconcile_hash',
  'transaction.refund.reconcile',
  'transaction.refund.replace',
  'treasury.stablebond.acquire',
  'treasury.stablebond.open_trustline',
  'treasury.stablebond.register_basis',
  'treasury.stablebond.unwind',
  'treasury.threshold.create',
  'treasury.threshold.update',
] as const

export type OpsMutationAction = typeof opsMutationActions[number]

export type OpsMutationDetails = {
  confirmation: string
  expectedVersion?: number
  idempotencyKey: string
  reason: string
  reference?: string
}

export type OpsMutationPolicy = {
  action: OpsMutationAction
  approvalClass: 'CONFIRMATION' | 'DIRECT' | 'SECOND_APPROVER' | 'STEP_UP'
  confirmation: string
  expectedVersion: boolean
  impact: string
  permission: string
  stepUpRequired: boolean
}
