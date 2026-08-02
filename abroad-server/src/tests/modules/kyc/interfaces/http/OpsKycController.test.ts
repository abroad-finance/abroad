import 'reflect-metadata'
import type { Request as ExpressRequest } from 'express'

import { KycStatus, OpsRole } from '@prisma/client'

import type { OpsKycDetail } from '../../../../../modules/kyc/application/OpsKycService'
import type { OpsUserPrincipal } from '../../../../../modules/operations/application/opsIdentity'

import { OpsKycService } from '../../../../../modules/kyc/application/OpsKycService'
import { OpsKycController } from '../../../../../modules/kyc/interfaces/http/OpsKycController'
import { OpsAuditService } from '../../../../../modules/operations/application/OpsAuditService'
import { OpsMutationService } from '../../../../../modules/operations/application/opsMutation'
import { getOpsRolePermissions } from '../../../../../modules/operations/application/opsPermissions'

const principal: OpsUserPrincipal = {
  authTime: new Date('2026-08-02T15:00:00.000Z'),
  displayName: 'Compliance Operator',
  email: 'compliance@abroad.finance',
  kind: 'ops_user',
  permissions: getOpsRolePermissions(OpsRole.COMPLIANCE),
  role: OpsRole.COMPLIANCE,
  sessionVersion: 1,
  userId: 'reviewer-1',
}

const request = { user: principal } as unknown as ExpressRequest

const detail: OpsKycDetail = {
  address: '123 Private Street',
  city: 'São Paulo',
  dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
  disabledAt: null,
  documentNumber: 'BR-PRIVATE-1234',
  documentType: 'NATIONAL_ID',
  email: 'ada@example.com',
  fullName: 'Ada Lovelace',
  hasDocument: true,
  id: '11111111-1111-4111-8111-111111111111',
  nationality: 'BR',
  partnerId: '22222222-2222-4222-8222-222222222222',
  partnerName: 'Acme Partner',
  partnerUserId: '33333333-3333-4333-8333-333333333333',
  phone: '+5511999999999',
  reviewedAt: null,
  reviewer: null,
  status: KycStatus.PENDING_APPROVAL,
  submittedAt: new Date('2026-08-01T12:00:00.000Z'),
  userId: 'external-user-1',
  version: 3,
}

const buildHarness = () => {
  const opsKycService = {
    getSubmission: jest.fn(),
    listSubmissions: jest.fn(),
  }
  const auditService = { record: jest.fn() }
  const controller = new OpsKycController(
    opsKycService as unknown as OpsKycService,
    {} as OpsMutationService,
    auditService as unknown as OpsAuditService,
  )
  return { auditService, controller, opsKycService }
}

describe('OpsKycController sensitive read evidence', () => {
  it('records a minimized queue-read audit event', async () => {
    const { auditService, controller, opsKycService } = buildHarness()
    opsKycService.listSubmissions.mockResolvedValue({
      items: [],
      page: 2,
      pageSize: 20,
      total: 0,
    })

    const result = await controller.listSubmissions(
      request,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      2,
      20,
    )

    expect(result.page).toBe(2)
    expect(auditService.record).toHaveBeenCalledWith(principal, {
      action: 'kyc.queue.viewed',
      metadata: { page: 2, pageSize: 20 },
      resourceType: 'kyc_queue',
    })
  })

  it('records the internal submission ID when sensitive detail is revealed', async () => {
    const { auditService, controller, opsKycService } = buildHarness()
    opsKycService.getSubmission.mockResolvedValue(detail)

    const result = await controller.getSubmission(detail.id, request)

    expect(result.fullName).toBe('Ada Lovelace')
    expect(auditService.record).toHaveBeenCalledWith(principal, {
      action: 'kyc.submission.revealed',
      resourceId: detail.id,
      resourceType: 'kyc_submission',
    })
  })
})
