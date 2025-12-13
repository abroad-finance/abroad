import type { ActionContext, ActionRequest } from 'adminjs'
import type AdminJSClass from 'adminjs'
import type { Request, Response } from 'express'

import { TransactionStatus } from '@prisma/client'

import type { PersonaInquiryDetailsService } from '../../modules/kyc/application/PersonaInquiryDetailsService'

import { createTransactionQuoteSupport } from '../../app/admin/transactionQuoteSupport'

type AdminModuleStub = {
  Filter: new (filters: Record<string, unknown>, resource: AdminResourceStub) => { populate: (context: ActionContext) => Promise<unknown> }
  flat: {
    flatten: (input: Record<string, unknown>) => Record<string, unknown>
    unflatten: (input: Record<string, unknown>) => Record<string, unknown>
  }
  populator: (records: AdminRecordStub[], context: ActionContext) => Promise<AdminRecordStub[]>
  ViewHelpers: new ({ options }: { options: unknown }) => { urlBuilder: (segments: string[], search: string) => string }
}
type AdminRecordStub = { toJSON: (currentAdmin: unknown) => { params: Record<string, unknown> } }

type AdminResourceStub = {
  count: jest.Mock<Promise<number>, [unknown, ActionContext]>
  decorate: jest.Mock<{
    actions: Record<string, { name: string }>
    getPropertyByKey: (key: string) => { label: () => string }
    id: () => string
  }>
  find: jest.Mock<Promise<AdminRecordStub[]>, [unknown, unknown, ActionContext]>
}

const flattenObject = (input: Record<string, unknown>, prefix = ''): Record<string, unknown> => {
  const entries: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    const path = prefix.length > 0 ? `${prefix}.${key}` : key
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(entries, flattenObject(value as Record<string, unknown>, path))
      continue
    }
    entries[path] = value
  }
  return entries
}

describe('createTransactionQuoteSupport', () => {
  let adminModule: AdminModuleStub
  let personaService: jest.Mocked<Pick<PersonaInquiryDetailsService, 'getDetails'>>
  let prisma: { partnerUserKyc: { findFirst: jest.Mock<Promise<null | { externalId: string }>, [unknown]> } }
  let support: ReturnType<typeof createTransactionQuoteSupport>
  let resource: AdminResourceStub
  let records: AdminRecordStub[]

  beforeEach(() => {
    const populator = jest.fn(async (items: AdminRecordStub[]) => items)
    const flat = {
      flatten: (input: Record<string, unknown>) => flattenObject(input),
      unflatten: (input: Record<string, unknown>) => ({ ...input }),
    }

    class FilterStub {
      private readonly filters: Record<string, unknown>
      private readonly resource: AdminResourceStub

      constructor(filters: Record<string, unknown>, resource: AdminResourceStub) {
        this.filters = filters
        this.resource = resource
      }

      async populate(): Promise<this> {
        // Mimic AdminJS Filter.populate chaining while ensuring branch coverage for populated filters.
        if (this.filters && this.resource) {
          return this
        }
        return this
      }
    }

    class ViewHelpersStub {
      private readonly options: unknown

      constructor({ options }: { options: unknown }) {
        this.options = options
      }

      urlBuilder(segments: string[], search: string): string {
        const base = `/${segments.join('/')}`
        return search.length > 0 ? `${base}${search}` : base
      }
    }

    adminModule = {
      Filter: FilterStub,
      flat,
      populator,
      ViewHelpers: ViewHelpersStub,
    }

    personaService = {
      getDetails: jest.fn(async (inquiryId: string) => {
        void inquiryId
        return {
          address: '742 Evergreen Terrace',
          city: 'Springfield',
          country: 'US',
          department: 'Any State',
          documentType: 'ID',
          email: 'lisa@example.com',
          fullName: 'Lisa Simpson',
          idNumber: 'ABC123',
          phone: '+123456789',
        }
      }),
    }

    prisma = {
      partnerUserKyc: {
        findFirst: jest.fn(),
      },
    }
    prisma.partnerUserKyc.findFirst.mockResolvedValue(null)

    const decoratedResource = {
      actions: {
        downloadCsv: { name: 'downloadCsv' },
        list: { name: 'list' },
      },
      getPropertyByKey: jest.fn((key: string) => ({
        label: () => `label:${key}`,
      })),
      id: jest.fn(() => 'TransactionQuoteDetailedView'),
    }

    records = [
      {
        toJSON: () => ({
          params: {
            cryptoCurrency: 'USDC',
            onChainId: 'hash-1',
            partnerUserId: 'partner-1',
            sourceAmount: '25',
            targetAmount: '1000',
            targetCurrency: 'COP',
            transactionCreatedAt: new Date('2024-05-01T02:03:04Z'),
          },
        }),
      },
      {
        toJSON: () => ({
          params: {
            cryptoCurrency: 'USDC',
            onChainId: 'hash-2',
            partnerUserId: 'partner-1',
            sourceAmount: '50',
            targetAmount: '2500',
            targetCurrency: 'COP',
            transactionCreatedAt: new Date('2024-05-02T02:03:04Z'),
          },
        }),
      },
    ]

    resource = {
      count: jest.fn(async (filter: unknown, context: ActionContext) => {
        void filter
        void context
        return records.length
      }),
      decorate: jest.fn(() => decoratedResource),
      find: jest.fn(async (filter: unknown, options: unknown, context: ActionContext) => {
        void filter
        void options
        void context
        return records
      }),
    }

    support = createTransactionQuoteSupport({
      adminModule: adminModule as unknown as typeof import('adminjs'),
      personaInquiryDetailsService: personaService as unknown as PersonaInquiryDetailsService,
      prisma: prisma as unknown as import('@prisma/client').PrismaClient,
    })
  })

  it('preserves provided filter values while enforcing default statuses', () => {
    const request: ActionRequest = {
      method: 'get',
      params: {
        action: 'list',
        resourceId: 'TransactionQuoteDetailedView',
      },
      payload: {
        'filters': { targetCurrency: 'BRL' },
        'filters.targetCurrency': 'BRL',
      },
      query: {
        'filters': {
          targetCurrency: 'USD',
          transactionStatus: TransactionStatus.PROCESSING_PAYMENT,
        },
        'filters.targetCurrency': 'USD',
      },
    }

    const normalized = support.ensureDefaultTransactionQuoteFilters(request)

    expect(normalized.query?.['filters.targetCurrency']).toBe('USD')
    expect((normalized.query as Record<string, unknown>).filters).toEqual({
      targetCurrency: 'USD',
      transactionStatus: TransactionStatus.PAYMENT_COMPLETED,
    })
    expect(normalized.payload?.['filters.targetCurrency']).toBe('BRL')
    expect((normalized.payload as Record<string, unknown>).filters).toEqual({
      targetCurrency: 'BRL',
      transactionStatus: TransactionStatus.PAYMENT_COMPLETED,
    })
  })

  it('applies default payload filters when target currency is missing', () => {
    const request: ActionRequest = {
      method: 'get',
      params: { action: 'list', resourceId: support.resourceId },
      payload: { filters: {} },
      query: {},
    }

    const normalized = support.ensureDefaultTransactionQuoteFilters(request)
    const payload = normalized.payload as Record<string, unknown>

    expect((payload.filters as Record<string, unknown>).targetCurrency).toBe('COP')
    expect((payload.filters as Record<string, unknown>).transactionStatus).toBe(TransactionStatus.PAYMENT_COMPLETED)
  })

  it('builds query strings from nested and array-based action parameters', () => {
    const params = support.buildActionRequestSearchParams({
      method: 'get',
      params: { action: 'list', resourceId: support.resourceId },
      payload: { filters: { targetCurrency: ['COP', 'USD'] } },
      query: { filters: { transactionStatus: ['PENDING'] } },
    } as unknown as ActionRequest)

    expect(params).toContain('filters.targetCurrency=USD')
    expect(params).toContain('filters.transactionStatus=PENDING')
  })

  it('builds redirect URLs for CSV downloads', async () => {
    const downloadHandler = support.detailedResource.options.actions.downloadCsv.handler!
    const context = {
      action: { name: support.downloadActionName },
      currentAdmin: null,
      h: new adminModule.ViewHelpers({ options: {} }),
      resource: resource as unknown as AdminResourceStub,
    } as unknown as ActionContext

    const result = await downloadHandler(
      {
        method: 'get',
        params: { action: support.downloadActionName, resourceId: support.resourceId },
        query: {},
      } as ActionRequest,
      {} as Response,
      context,
    )

    expect(result.redirectUrl).toContain('/transaction-quotes/download')
    expect(result.notice?.type).toBe('success')
  })

  it('enriches list and show responses when records are present', async () => {
    const listAfter = support.detailedResource.options.actions.list.after!
    const showAfter = support.detailedResource.options.actions.show.after!

    const hydratedRecords = records.map(record => ({
      ...record,
      params: record.toJSON(null as unknown as never).params,
    })) as unknown as import('adminjs').BaseRecord[]

    const listResponse = await listAfter({ records: hydratedRecords } as unknown as import('adminjs').ActionResponse)
    const showResponse = await showAfter({ record: hydratedRecords[0] } as unknown as import('adminjs').ActionResponse)

    expect(listResponse).toBeTruthy()
    expect(showResponse).toBeTruthy()
  })

  it('returns 404 when CSV resource cannot be found', async () => {
    const admin = {
      findResource: jest.fn(() => undefined),
      options: {},
    } as unknown as AdminJSClass
    const handler = support.createCsvRouteHandler(admin)
    const status = jest.fn().mockReturnThis()
    const send = jest.fn()
    const res = { send, status } as unknown as Response

    await handler({ query: {}, session: {} } as unknown as Request, res, jest.fn())

    expect(status).toHaveBeenCalledWith(404)
    expect(send).toHaveBeenCalledWith('Resource not found')
  })

  it('streams a CSV using enriched transaction quote data', async () => {
    prisma.partnerUserKyc.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ externalId: 'kyc-123' })

    const req = {
      query: { filters: {}, q: ['a', 'b'] },
      session: { adminUser: { email: 'admin@example.com' } },
    } as unknown as Request

    const sentHeaders: Record<string, string> = {}
    const res = {
      send: jest.fn(),
      setHeader: jest.fn((key: string, value: string) => {
        sentHeaders[key] = value
      }),
      status: jest.fn(() => res),
    } as unknown as Response

    const admin: AdminJSClass = {
      findResource: () => resource,
      options: {},
    } as unknown as AdminJSClass

    const next = jest.fn()

    const handler = support.createCsvRouteHandler(admin)
    await handler(req, res, next)

    expect(resource.count).toHaveBeenCalled()
    expect(resource.find).toHaveBeenCalled()
    expect(prisma.partnerUserKyc.findFirst).toHaveBeenCalledTimes(2)
    expect(personaService.getDetails).toHaveBeenCalledWith('kyc-123')
    expect(sentHeaders['Content-Type']).toBe('text/csv; charset=utf-8')
    expect(sentHeaders['Content-Disposition']).toContain('transaction-quote-detailed-view.csv')
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Venta'))
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('hash-2'))
    expect(next).not.toHaveBeenCalled()
  })

  it('falls back to fixed formatting when locale formatting fails', async () => {
    const localeSpy = jest.spyOn(Number.prototype, 'toLocaleString').mockImplementation(() => {
      throw new Error('locale failure')
    })

    try {
      const listAfter = support.detailedResource.options.actions.list.after!
      const hydratedRecords = records.map(record => ({
        ...record,
        params: record.toJSON(null as unknown as never).params,
      })) as unknown as import('adminjs').BaseRecord[]

      await listAfter({ records: hydratedRecords } as unknown as import('adminjs').ActionResponse)

      const enriched = hydratedRecords[0] as unknown as { params: Record<string, unknown> }
      expect(enriched.params.montoCop).toBe('1000.00')
      expect(enriched.params.trm).toBe('40.00')
    }
    finally {
      localeSpy.mockRestore()
    }
  })

  it('keeps invalid numeric inputs empty after enrichment', async () => {
    const showAfter = support.detailedResource.options.actions.show.after!
    const malformedRecord = {
      params: {
        cryptoCurrency: 'USDC',
        sourceAmount: { nested: true },
        targetAmount: ['invalid'],
        targetCurrency: 'COP',
        transactionCreatedAt: 'not-a-date',
      },
    } as unknown as import('adminjs').BaseRecord

    await showAfter({ record: malformedRecord } as unknown as import('adminjs').ActionResponse)

    expect(malformedRecord.params.montoCop).toBe('')
    expect(malformedRecord.params.montoUsdc).toBe('')
    expect(malformedRecord.params.trm).toBe('')
    expect(malformedRecord.params.fecha).toBe('')
  })

  it('forwards CSV generation errors to middleware', async () => {
    const admin = {
      findResource: jest.fn(() => resource),
      options: {},
    } as unknown as AdminJSClass
    const handler = support.createCsvRouteHandler(admin)
    const res = {
      send: jest.fn(),
      setHeader: jest.fn(),
      status: jest.fn(() => res),
    } as unknown as Response
    const next = jest.fn()

    resource.decorate.mockImplementationOnce(() => {
      throw new Error('decorate failure')
    })

    await handler({ query: {}, session: {} } as unknown as Request, res, next)

    expect(next).toHaveBeenCalledWith(expect.any(Error))
  })

  it('normalizes query params by flattening arrays and skipping undefined', () => {
    const normalized = support.normalizeQueryParams({
      empty: undefined,
      keep: 'value',
      list: ['first', 'second'],
    })

    expect(normalized).toEqual({ keep: 'value', list: 'second' })
  })

  it('enriches records with formatted amounts, dates, and operation labels', async () => {
    const showAfter = support.detailedResource.options.actions.show.after!
    const record = {
      params: {
        cryptoCurrency: 'USDC',
        sourceAmount: '1,234.50',
        targetAmount: 2469,
        targetCurrency: 'USD',
        transactionCreatedAt: '2024-01-02T03:04:05Z',
      },
    } as unknown as import('adminjs').BaseRecord

    await showAfter({ record } as unknown as import('adminjs').ActionResponse)

    expect(record.params.montoUsdc).toMatch(/1[.,]234[.,]50/)
    expect(record.params.montoCop).toBe('')
    expect(record.params.trm).toMatch(/2[.,]00/)
    expect(record.params.fecha).toBe('2024-01-02 03:04')
    expect(record.params.tipoOperacion).toBe('Compra')
  })

  it('escapes CSV values containing commas, quotes, and objects', async () => {
    prisma.partnerUserKyc.findFirst
      .mockResolvedValueOnce({ externalId: 'escape-kyc' })
    personaService.getDetails.mockResolvedValueOnce({
      address: '123 Main St',
      city: 'Bogota',
      country: 'CO',
      department: 'Cundinamarca',
      documentType: 'ID',
      email: 'doe@example.com',
      fullName: 'Doe, "Jane"',
      idNumber: 'ABC123',
      phone: '+5712345678',
    })

    const customRecords: AdminRecordStub[] = [
      {
        toJSON: () => ({
          params: {
            partnerUserId: 'partner-escape',
            targetAmount: 10,
            targetCurrency: 'USD',
            transactionCreatedAt: new Date('2024-04-02T00:00:00Z'),
          },
        }),
      },
    ]

    resource.find = jest.fn<Promise<AdminRecordStub[]>, [unknown, unknown, ActionContext]>(
      async (...args) => {
        void args
        return customRecords
      },
    )
    resource.count = jest.fn<Promise<number>, [unknown, ActionContext]>(
      async (...args) => {
        void args
        return customRecords.length
      },
    )

    const req = {
      query: { filters: {} },
      session: { adminUser: { email: 'admin@example.com' } },
    } as unknown as Request

    const send = jest.fn()
    const res = {
      send,
      setHeader: jest.fn(),
      status: jest.fn(() => res),
    } as unknown as Response

    const admin: AdminJSClass = {
      findResource: () => resource,
      options: {},
    } as unknown as AdminJSClass

    const handler = support.createCsvRouteHandler(admin)
    await handler(req, res, jest.fn())

    const csv = send.mock.calls[0]?.[0] as string | undefined
    expect(csv).toBeDefined()
    expect(csv).toContain('"Doe, ""Jane"""')
    expect(csv).toContain('label:nombreRazonSocial')
  })
})

describe('transactionQuoteSupport bootstrap', () => {
  it('throws when the Prisma view model is missing', async () => {
    jest.resetModules()

    await jest.isolateModulesAsync(async () => {
      jest.doMock('@prisma/client', () => ({
        KycStatus: { APPROVED: 'APPROVED' },
        Prisma: { dmmf: { datamodel: { models: [] } } },
        TransactionStatus: { PAYMENT_COMPLETED: 'PAYMENT_COMPLETED' },
      }))

      await expect(import('../../app/admin/transactionQuoteSupport')).rejects.toThrow('Prisma model not found: TransactionQuoteView')
    })

    jest.dontMock('@prisma/client')
  })
})
