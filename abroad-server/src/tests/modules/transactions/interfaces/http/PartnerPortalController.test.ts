import 'reflect-metadata'

import type { Partner } from '@prisma/client'
import type { TsoaResponse } from '@tsoa/runtime'

import { TransactionStatus } from '@prisma/client'

import { PartnerPortalSessionService } from '../../../../../modules/partners/application/PartnerPortalSessionService'
import { PartnerTransactionNotFoundError, PartnerTransactionQueryService, PartnerTransactionQueryValidationError } from '../../../../../modules/transactions/application/PartnerTransactionQueryService'
import { PartnerPortalController } from '../../../../../modules/transactions/interfaces/http/PartnerPortalController'

type QueryServiceMock = Pick<PartnerTransactionQueryService, 'exportCsv' | 'getById' | 'search'>
type SessionServiceMock = Pick<PartnerPortalSessionService, 'createSession'>

const partner = { id: 'partner-1', name: 'Decaf' } as Partner
const request = { user: partner } as unknown as import('express').Request

const badRequestResponder = (): TsoaResponse<400, { reason: string }> => (
  jest.fn((_status: 400, payload: { reason: string }) => payload)
)

const notFoundResponder = (): TsoaResponse<404, { reason: string }> => (
  jest.fn((_status: 404, payload: { reason: string }) => payload)
)

const buildSessionService = (): jest.Mocked<SessionServiceMock> => {
  const createSession = jest.fn<
    ReturnType<PartnerPortalSessionService['createSession']>,
    Parameters<PartnerPortalSessionService['createSession']>
  >()
  createSession.mockResolvedValue({
    accessToken: 'portal-token',
    expiresAt: new Date('2026-07-31T12:30:00.000Z'),
    partnerName: 'Decaf',
  })
  return { createSession }
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
  sessionService: SessionServiceMock = buildSessionService(),
  queryService: QueryServiceMock = buildQueryService(),
) => new PartnerPortalController(
  sessionService as PartnerPortalSessionService,
  queryService as PartnerTransactionQueryService,
)

describe('PartnerPortalController', () => {
  it('creates a no-store session for the authenticated partner', async () => {
    const sessionService = buildSessionService()
    const controller = buildController(sessionService)
    const setHeader = jest.spyOn(controller, 'setHeader')

    const result = await controller.createSession(request)

    expect(sessionService.createSession).toHaveBeenCalledWith(partner)
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
    expect(result.accessToken).toBe('portal-token')
  })

  it('forwards tenant-owned list filters and pagination', async () => {
    const queryService = buildQueryService()
    const controller = buildController(buildSessionService(), queryService)

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
    const controller = buildController(buildSessionService(), queryService)
    const badRequest = badRequestResponder()

    const result = await controller.listTransactions(request, badRequest)

    expect(badRequest).toHaveBeenCalledWith(400, { reason: 'Invalid dates' })
    expect(result).toEqual({ reason: 'Invalid dates' })
  })

  it('returns the same HTTP 404 for unavailable transaction details', async () => {
    const queryService = buildQueryService()
    queryService.getById.mockRejectedValue(new PartnerTransactionNotFoundError())
    const controller = buildController(buildSessionService(), queryService)
    const notFound = notFoundResponder()

    const result = await controller.getTransaction('transaction-1', request, notFound)

    expect(queryService.getById).toHaveBeenCalledWith('partner-1', 'transaction-1')
    expect(notFound).toHaveBeenCalledWith(404, { reason: 'Transaction not found' })
    expect(result).toEqual({ reason: 'Transaction not found' })
  })

  it('sets bounded download headers for CSV exports', async () => {
    const queryService = buildQueryService()
    queryService.exportCsv.mockResolvedValue({ csv: 'header\r\n', rowCount: 5_000, truncated: true })
    const controller = buildController(buildSessionService(), queryService)
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
