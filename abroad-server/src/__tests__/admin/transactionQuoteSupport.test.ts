import type { ActionContext, ActionRequest } from 'adminjs'
import type AdminJSClass from 'adminjs'
import type { Request, Response } from 'express'

import { TransactionStatus } from '@prisma/client'

import type { PersonaInquiryDetailsService } from '../../services/PersonaInquiryDetailsService'

import { createTransactionQuoteSupport } from '../../admin/transactionQuoteSupport'

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
})
