import 'reflect-metadata'

import type { Partner } from '@prisma/client'
import type { TsoaResponse } from '@tsoa/runtime'

import { PartnerPortalRole, TransactionStatus } from '@prisma/client'

import { PartnerPortalAccountService, PartnerPortalAuthenticationError } from '../../../../../modules/partners/application/PartnerPortalAccountService'
import { PartnerPortalPrincipal } from '../../../../../modules/partners/application/PartnerPortalSessionService'
import { PartnerPixReceiptService } from '../../../../../modules/transactions/application/PartnerPixReceiptService'
import { PartnerPixReconciliationService } from '../../../../../modules/transactions/application/PartnerPixReconciliationService'
import { PartnerTransactionNotFoundError, PartnerTransactionQueryService, PartnerTransactionQueryValidationError } from '../../../../../modules/transactions/application/PartnerTransactionQueryService'
import { PartnerWebhookRedeliveryService } from '../../../../../modules/transactions/application/PartnerWebhookRedeliveryService'
import { PartnerPortalController } from '../../../../../modules/transactions/interfaces/http/PartnerPortalController'

type AccountServiceMock = Pick<PartnerPortalAccountService, 'authenticate'>
type QueryServiceMock = Pick<PartnerTransactionQueryService, 'exportCsv' | 'getById' | 'search'>

const partner = { id: 'partner-1', name: 'Decaf' } as Partner
const principal: PartnerPortalPrincipal = {
  authenticationSource: 'PARTNER_PORTAL',
  email: 'operator@decaf.so',
  kind: 'partner_portal',
  mfaEnabled: true,
  mfaVerified: true,
  partner,
  role: PartnerPortalRole.ADMIN,
  userId: 'portal-user-1',
}
const request = { user: principal } as unknown as import('express').Request

const badRequestResponder = (): TsoaResponse<400, { reason: string }> => (
  jest.fn((_status: 400, payload: { reason: string }) => payload)
)

const unauthorizedResponder = (): TsoaResponse<401, { reason: string }> => (
  jest.fn((_status: 401, payload: { reason: string }) => payload)
)

const notFoundResponder = (): TsoaResponse<404, { reason: string }> => (
  jest.fn((_status: 404, payload: { reason: string }) => payload)
)

const buildAccountService = (): jest.Mocked<AccountServiceMock> => {
  const authenticate = jest.fn<
    ReturnType<PartnerPortalAccountService['authenticate']>,
    Parameters<PartnerPortalAccountService['authenticate']>
  >()
  authenticate.mockResolvedValue({
    session: {
      accessToken: 'portal-token',
      email: principal.email,
      expiresAt: new Date('2026-07-31T12:30:00.000Z'),
      mfaEnabled: false,
      mfaVerified: false,
      partnerName: 'Decaf',
      role: PartnerPortalRole.ADMIN,
      userId: principal.userId,
    },
    status: 'AUTHENTICATED',
  })
  return { authenticate }
}

const buildQueryService = (): jest.Mocked<QueryServiceMock> => {
  const exportCsv = jest.fn<
    ReturnType<PartnerTransactionQueryService['exportCsv']>,
    Parameters<PartnerTransactionQueryService['exportCsv']>
  >()
  exportCsv.mockResolvedValue({
    csv: 'header\r\n',
    rowCount: 0,
    truncated: false,
  })
  const getById = jest.fn<
    ReturnType<PartnerTransactionQueryService['getById']>,
    Parameters<PartnerTransactionQueryService['getById']>
  >()
  const search = jest.fn<
    ReturnType<PartnerTransactionQueryService['search']>,
    Parameters<PartnerTransactionQueryService['search']>
  >()
  search.mockResolvedValue({
    items: [],
    page: 1,
    pageSize: 20,
    statusCounts: [],
    total: 0,
  })
  return { exportCsv, getById, search }
}

const buildController = (
  accountService: AccountServiceMock = buildAccountService(),
  queryService: QueryServiceMock = buildQueryService(),
) => new PartnerPortalController(
  accountService as PartnerPortalAccountService,
  queryService as PartnerTransactionQueryService,
  {} as unknown as PartnerPixReceiptService,
  {} as unknown as PartnerPixReconciliationService,
  {} as unknown as PartnerWebhookRedeliveryService,
)

describe('PartnerPortalController', () => {
  it('creates a no-store session from email and password', async () => {
    const accountService = buildAccountService()
    const controller = buildController(accountService)
    const setHeader = jest.spyOn(controller, 'setHeader')

    const result = await controller.createSession(
      { email: ' Operator@Decaf.So ', password: 'correct horse battery staple' },
      badRequestResponder(),
      unauthorizedResponder(),
    )

    expect(accountService.authenticate).toHaveBeenCalledWith({
      email: 'Operator@Decaf.So',
      password: 'correct horse battery staple',
    })
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
    expect(result).toEqual(expect.objectContaining({
      session: expect.objectContaining({ accessToken: 'portal-token' }),
      status: 'AUTHENTICATED',
    }))
  })

  it('rejects malformed credentials before authentication', async () => {
    const accountService = buildAccountService()
    const controller = buildController(accountService)
    const badRequest = badRequestResponder()

    const result = await controller.createSession(
      { email: 'not-an-email', password: '' },
      badRequest,
      unauthorizedResponder(),
    )

    expect(result).toEqual({ reason: 'Enter a valid email and password' })
    expect(badRequest).toHaveBeenCalledWith(400, {
      reason: 'Enter a valid email and password',
    })
    expect(accountService.authenticate).not.toHaveBeenCalled()
  })

  it('returns one generic authentication error for invalid credentials', async () => {
    const accountService = buildAccountService()
    accountService.authenticate.mockRejectedValueOnce(new PartnerPortalAuthenticationError())
    const controller = buildController(accountService)
    const unauthorized = unauthorizedResponder()

    const result = await controller.createSession(
      { email: 'operator@decaf.so', password: 'incorrect-password' },
      badRequestResponder(),
      unauthorized,
    )

    expect(result).toEqual({ reason: 'Email or password is incorrect' })
    expect(unauthorized).toHaveBeenCalledWith(401, {
      reason: 'Email or password is incorrect',
    })
  })

  it('forwards tenant-owned list filters and pagination', async () => {
    const queryService = buildQueryService()
    const controller = buildController(buildAccountService(), queryService)

    await controller.listTransactions(
      request,
      badRequestResponder(),
      'reference',
      TransactionStatus.PAYMENT_COMPLETED,
      '2026-07-01',
      '2026-07-31',
      2,
      50,
    )

    expect(queryService.search).toHaveBeenCalledWith('partner-1', {
      createdFrom: '2026-07-01',
      createdTo: '2026-07-31',
      page: 2,
      pageSize: 50,
      query: 'reference',
      status: TransactionStatus.PAYMENT_COMPLETED,
    })
  })

  it('maps public query validation failures to HTTP 400', async () => {
    const queryService = buildQueryService()
    queryService.search.mockRejectedValue(new PartnerTransactionQueryValidationError('Invalid dates'))
    const controller = buildController(buildAccountService(), queryService)
    const badRequest = badRequestResponder()

    const result = await controller.listTransactions(request, badRequest)

    expect(badRequest).toHaveBeenCalledWith(400, { reason: 'Invalid dates' })
    expect(result).toEqual({ reason: 'Invalid dates' })
  })

  it('returns the same HTTP 404 for unavailable transaction details', async () => {
    const queryService = buildQueryService()
    queryService.getById.mockRejectedValue(new PartnerTransactionNotFoundError())
    const controller = buildController(buildAccountService(), queryService)
    const notFound = notFoundResponder()

    const result = await controller.getTransaction('transaction-1', request, notFound)

    expect(queryService.getById).toHaveBeenCalledWith('partner-1', 'transaction-1')
    expect(notFound).toHaveBeenCalledWith(404, { reason: 'Transaction not found' })
    expect(result).toEqual({ reason: 'Transaction not found' })
  })

  it('sets bounded download headers for CSV exports', async () => {
    const queryService = buildQueryService()
    queryService.exportCsv.mockResolvedValue({ csv: 'header\r\n', rowCount: 5_000, truncated: true })
    const controller = buildController(buildAccountService(), queryService)
    const setHeader = jest.spyOn(controller, 'setHeader')

    const result = await controller.exportTransactions(
      request,
      badRequestResponder(),
      undefined,
      TransactionStatus.PAYMENT_COMPLETED,
    )

    expect(queryService.exportCsv).toHaveBeenCalledWith('partner-1', expect.objectContaining({
      status: TransactionStatus.PAYMENT_COMPLETED,
    }))
    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8')
    expect(setHeader).toHaveBeenCalledWith('X-Export-Row-Count', '5000')
    expect(setHeader).toHaveBeenCalledWith('X-Export-Truncated', 'true')
    expect(result).toBe('header\r\n')
  })
})
