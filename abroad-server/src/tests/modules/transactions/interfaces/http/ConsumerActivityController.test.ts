import 'reflect-metadata'

import type { Partner } from '@prisma/client'
import type { TsoaResponse } from '@tsoa/runtime'

import { ConsumerActivityNotFoundError, ConsumerActivityValidationError, IConsumerActivityService } from '../../../../../modules/transactions/application/ConsumerActivityService'
import { IPartnerPixReceiptService, PartnerPixReceiptProviderError, PartnerPixReceiptUnavailableError } from '../../../../../modules/transactions/application/PartnerPixReceiptService'
import { ConsumerActivityController } from '../../../../../modules/transactions/interfaces/http/ConsumerActivityController'

type ActivityServiceMock = Pick<IConsumerActivityService, 'getById' | 'list'>

const partner = { id: 'partner-1' } as Partner
const request = {
  user: {
    ...partner,
    authenticatedSubject: 'stellar:pubnet:GABC',
    authenticationSource: 'WALLET',
  },
} as unknown as import('express').Request

const badRequestResponder = (): TsoaResponse<400, { reason: string }> => (
  jest.fn((_status: 400, payload: { reason: string }) => payload)
)
const notFoundResponder = (): TsoaResponse<404, { reason: string }> => (
  jest.fn((_status: 404, payload: { reason: string }) => payload)
)
const conflictResponder = (): TsoaResponse<409, { reason: string }> => (
  jest.fn((_status: 409, payload: { reason: string }) => payload)
)
const badGatewayResponder = (): TsoaResponse<502, { reason: string }> => (
  jest.fn((_status: 502, payload: { reason: string }) => payload)
)

const buildService = (): jest.Mocked<ActivityServiceMock> => {
  const getById = jest.fn<
    ReturnType<IConsumerActivityService['getById']>,
    Parameters<IConsumerActivityService['getById']>
  >()
  const list = jest.fn<
    ReturnType<IConsumerActivityService['list']>,
    Parameters<IConsumerActivityService['list']>
  >()
  list.mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 })
  return { getById, list }
}

const buildReceiptService = (): jest.Mocked<IPartnerPixReceiptService> => ({
  getReceipt: jest.fn(),
})

const buildController = (
  service: jest.Mocked<ActivityServiceMock> = buildService(),
  receiptService: jest.Mocked<IPartnerPixReceiptService> = buildReceiptService(),
): ConsumerActivityController => new ConsumerActivityController(
  service,
  receiptService,
)

describe('ConsumerActivityController', () => {
  it('lists only the authenticated wallet subject and forwards server filters', async () => {
    const service = buildService()
    const controller = buildController(service)
    const setHeader = jest.spyOn(controller, 'setHeader')

    const result = await controller.listActivity(
      request,
      badRequestResponder(),
      'PAYMENT_COMPLETED',
      'PIX',
      'STELLAR',
      'BRL',
      '2026-08-01',
      '2026-08-02',
      2,
      10,
    )

    expect(service.list).toHaveBeenCalledWith('partner-1', 'stellar:pubnet:GABC', {
      createdFrom: '2026-08-01',
      createdTo: '2026-08-02',
      network: 'STELLAR',
      page: 2,
      pageSize: 10,
      paymentMethod: 'PIX',
      sort: 'newest',
      status: 'PAYMENT_COMPLETED',
      targetCurrency: 'BRL',
    })
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store')
    expect(result.total).toBe(0)
  })

  it('maps invalid list filters to HTTP 400', async () => {
    const service = buildService()
    service.list.mockRejectedValueOnce(new ConsumerActivityValidationError('Invalid filters'))
    const badRequest = badRequestResponder()
    const controller = buildController(service)

    const result = await controller.listActivity(request, badRequest)

    expect(badRequest).toHaveBeenCalledWith(400, { reason: 'Invalid filters' })
    expect(result).toEqual({ reason: 'Invalid filters' })
  })

  it('returns an owned detail and maps missing or unauthorized identity to HTTP 404', async () => {
    const service = buildService()
    service.getById.mockRejectedValueOnce(new ConsumerActivityNotFoundError())
    const notFound = notFoundResponder()
    const controller = buildController(service)

    const result = await controller.getActivity(
      '11111111-1111-4111-8111-111111111111',
      request,
      badRequestResponder(),
      notFound,
    )

    expect(service.getById).toHaveBeenCalledWith(
      'partner-1',
      'stellar:pubnet:GABC',
      '11111111-1111-4111-8111-111111111111',
    )
    expect(notFound).toHaveBeenCalledWith(404, { reason: 'Activity transaction not found' })
    expect(result).toEqual({ reason: 'Activity transaction not found' })
  })

  it('maps malformed detail identity to HTTP 400', async () => {
    const service = buildService()
    service.getById.mockRejectedValueOnce(
      new ConsumerActivityValidationError('Transaction ID must be a UUID'),
    )
    const badRequest = badRequestResponder()
    const controller = buildController(service)

    const result = await controller.getActivity(
      'not-a-uuid',
      request,
      badRequest,
      notFoundResponder(),
    )

    expect(badRequest).toHaveBeenCalledWith(400, { reason: 'Transaction ID must be a UUID' })
    expect(result).toEqual({ reason: 'Transaction ID must be a UUID' })
  })

  it('rejects a non-wallet bearer principal before querying Activity', async () => {
    const service = buildService()
    const controller = buildController(service)
    const sepRequest = {
      user: {
        ...partner,
        authenticatedSubject: 'stellar:pubnet:GABC',
        authenticationSource: 'SEP_24',
      },
    } as unknown as import('express').Request

    await expect(controller.listActivity(sepRequest, badRequestResponder())).rejects.toThrow(
      'Authenticated wallet context is unavailable',
    )
    expect(service.list).not.toHaveBeenCalled()
  })

  it('authorizes receipt ownership before returning provider proof', async () => {
    const service = buildService()
    const receiptService = buildReceiptService()
    const receipt = {
      contentBase64: 'JVBERi0xLjQ=',
      contentType: 'application/pdf' as const,
      fileName: 'receipt.pdf',
      sizeBytes: 8,
    }
    service.getById.mockResolvedValue({ id: 'owned' } as never)
    receiptService.getReceipt.mockResolvedValue(receipt)
    const controller = buildController(service, receiptService)

    const result = await controller.getReceipt(
      '11111111-1111-4111-8111-111111111111',
      request,
      badRequestResponder(),
      notFoundResponder(),
      conflictResponder(),
      badGatewayResponder(),
      'en',
    )

    expect(service.getById).toHaveBeenCalledWith(
      'partner-1',
      'stellar:pubnet:GABC',
      '11111111-1111-4111-8111-111111111111',
    )
    expect(receiptService.getReceipt).toHaveBeenCalledWith(
      'partner-1',
      '11111111-1111-4111-8111-111111111111',
      'en',
    )
    expect(result).toEqual(receipt)
  })

  it('does not call the provider receipt service when the wallet does not own the transaction', async () => {
    const service = buildService()
    const receiptService = buildReceiptService()
    service.getById.mockRejectedValue(new ConsumerActivityNotFoundError())
    const notFound = notFoundResponder()
    const controller = buildController(service, receiptService)

    const result = await controller.getReceipt(
      '11111111-1111-4111-8111-111111111111',
      request,
      badRequestResponder(),
      notFound,
      conflictResponder(),
      badGatewayResponder(),
    )

    expect(receiptService.getReceipt).not.toHaveBeenCalled()
    expect(notFound).toHaveBeenCalledWith(404, { reason: 'Activity transaction not found' })
    expect(result).toEqual({ reason: 'Activity transaction not found' })
  })

  it('maps unavailable and provider receipt errors without exposing provider detail', async () => {
    const service = buildService()
    const receiptService = buildReceiptService()
    service.getById.mockResolvedValue({ id: 'owned' } as never)
    receiptService.getReceipt.mockRejectedValueOnce(new PartnerPixReceiptUnavailableError())
    const unavailable = conflictResponder()
    const controller = buildController(service, receiptService)

    const unavailableResult = await controller.getReceipt(
      '11111111-1111-4111-8111-111111111111', request, badRequestResponder(),
      notFoundResponder(), unavailable, badGatewayResponder(),
    )
    expect(unavailable).toHaveBeenCalledWith(409, { reason: 'The PIX receipt is not available yet' })
    expect(unavailableResult).toEqual({ reason: 'The PIX receipt is not available yet' })

    receiptService.getReceipt.mockRejectedValueOnce(new PartnerPixReceiptProviderError())
    const badGateway = badGatewayResponder()
    const providerResult = await controller.getReceipt(
      '11111111-1111-4111-8111-111111111111', request, badRequestResponder(),
      notFoundResponder(), conflictResponder(), badGateway,
    )
    expect(badGateway).toHaveBeenCalledWith(502, { reason: 'The PIX receipt provider is temporarily unavailable' })
    expect(providerResult).toEqual({ reason: 'The PIX receipt provider is temporarily unavailable' })
  })
})
