import type { PrismaClient } from '@prisma/client'
import type {
  ActionContext,
  ActionQueryParameters,
  ActionRequest,
  ActionResponse,
  AdminJSOptions,
} from 'adminjs'
import type AdminJSClass from 'adminjs'
import type { NextFunction, Request, Response } from 'express'

import { KycStatus, Prisma, TransactionStatus } from '@prisma/client'

import type { PersonaInquiryDetails } from '../../modules/kyc/application/PersonaInquiryDetailsService'
import type { PersonaInquiryDetailsService } from '../../modules/kyc/application/PersonaInquiryDetailsService'

import { buildActionRequestSearchParams, ensureDefaultTransactionQuoteFilters, normalizeQueryParams } from './transactionQuoteFilters'
import {
  applyQuoteProjection,
  assignTransactionMetadata,
  escapeCsvValue,
  hydratePersonaAndQuoteFields,
  parseNumber,
} from './transactionQuoteFormatters'
import { transactionQuoteProperties } from './transactionQuoteProperties'

type AdminModule = typeof import('adminjs')
type AdminRecord = { params: Record<string, unknown> }
type AdminResourceConfig = NonNullable<AdminJSOptions['resources']>[number]

const TRANSACTION_QUOTE_LIST_COLUMNS = [
  'fecha',
  'tipoDocumento',
  'numeroDocumento',
  'nombreRazonSocial',
  'direccion',
  'telefono',
  'email',
  'pais',
  'departamento',
  'municipio',
  'montoCop',
  'montoUsdc',
  'trm',
  'hashTransaccion',
  'tipoOperacion',
] as const

const TRANSACTION_QUOTE_CSV_ROUTE = '/transaction-quotes/download.csv' as const
const TRANSACTION_QUOTE_CSV_ROUTE_SEGMENTS = TRANSACTION_QUOTE_CSV_ROUTE
  .split('/')
  .filter(segment => segment.length > 0)
const TRANSACTION_QUOTE_RESOURCE_ID = 'TransactionQuoteDetailedView' as const
const TRANSACTION_QUOTE_DOWNLOAD_ACTION_NAME = 'downloadCsv' as const

const DEFAULT_TRANSACTION_QUOTE_CURRENCY = 'COP' as const
const DEFAULT_TRANSACTION_QUOTE_STATUS = TransactionStatus.PAYMENT_COMPLETED
const FILTER_DEFAULTS = {
  currency: DEFAULT_TRANSACTION_QUOTE_CURRENCY,
  status: DEFAULT_TRANSACTION_QUOTE_STATUS,
} as const
const FIAT_TARGET_CURRENCIES = new Set(['BRL', 'COP'])

export interface TransactionQuoteSupport {
  baseResource: AdminResourceConfig
  buildActionRequestSearchParams(request: ActionRequest): string
  createCsvRouteHandler(admin: AdminJSClass): (req: Request, res: Response, next: NextFunction) => Promise<void>
  csvRoute: string
  detailedResource: AdminResourceConfig
  downloadActionName: typeof TRANSACTION_QUOTE_DOWNLOAD_ACTION_NAME
  ensureDefaultTransactionQuoteFilters<T extends ActionRequest>(request: T): T
  normalizeQueryParams(query: Request['query']): Record<string, unknown>
  resourceId: typeof TRANSACTION_QUOTE_RESOURCE_ID
  streamTransactionQuoteCsv: StreamCsv
}

type StreamCsv = (
  request: ActionRequest,
  response: Response,
  context: ActionContext,
) => Promise<void>

interface TransactionQuoteSupportDeps {
  adminModule: AdminModule
  personaInquiryDetailsService: PersonaInquiryDetailsService
  prisma: PrismaClient
}

const transactionQuoteViewModel = (() => {
  const baseModel = Prisma.dmmf.datamodel.models.find(model => model.name === 'TransactionQuoteView')
  if (!baseModel) {
    throw new Error('Prisma model not found: TransactionQuoteView')
  }
  const clonedModel = JSON.parse(JSON.stringify(baseModel)) as typeof baseModel
  const fields = clonedModel.fields as unknown as Array<{
    isId?: boolean
    isRequired?: boolean
    name: string
  }>
  const idField = fields.find(field => field.name === 'id')
  if (idField) {
    idField.isId = true
    idField.isRequired = true
  }
  return clonedModel
})()

export function createTransactionQuoteSupport(deps: TransactionQuoteSupportDeps): TransactionQuoteSupport {
  const { adminModule, personaInquiryDetailsService, prisma } = deps

  const kycInquiryCache = new Map<string, null | string>()
  const enforceDefaultFilters = <T extends ActionRequest>(request: T): T =>
    ensureDefaultTransactionQuoteFilters(request, FILTER_DEFAULTS)
  const buildSearchParams = (request: ActionRequest): string =>
    buildActionRequestSearchParams(adminModule.flat, request)

  const getInquiryIdForPartnerUser = async (partnerUserId: string): Promise<null | string> => {
    if (kycInquiryCache.has(partnerUserId)) {
      return kycInquiryCache.get(partnerUserId) ?? null
    }

    const approved = await prisma.partnerUserKyc.findFirst({
      orderBy: { createdAt: 'desc' },
      where: { partnerUserId, status: KycStatus.APPROVED },
    })

    let record = approved
    if (!record) {
      record = await prisma.partnerUserKyc.findFirst({
        orderBy: { createdAt: 'desc' },
        where: { partnerUserId },
      })
    }

    const inquiryId = record?.externalId ?? null
    kycInquiryCache.set(partnerUserId, inquiryId)
    return inquiryId
  }

  const enrichRecord = async (record: AdminRecord) => {
    const partnerUserId = typeof record.params.partnerUserId === 'string'
      ? record.params.partnerUserId
      : undefined

    let personaDetails: null | PersonaInquiryDetails = null
    if (partnerUserId) {
      const inquiryId = await getInquiryIdForPartnerUser(partnerUserId)
      if (inquiryId) {
        personaDetails = await personaInquiryDetailsService.getDetails(inquiryId)
      }
    }

    hydratePersonaAndQuoteFields(record, personaDetails, FIAT_TARGET_CURRENCIES)
    assignTransactionMetadata(
      record,
      record.params.transactionCreatedAt,
      record.params.onChainId,
      FIAT_TARGET_CURRENCIES,
    )

    const targetAmount = parseNumber(record.params.targetAmount)
    const sourceAmount = parseNumber(record.params.sourceAmount)
    const cryptoCurrency = typeof record.params.cryptoCurrency === 'string'
      ? record.params.cryptoCurrency
      : undefined
    const targetCurrency = typeof record.params.targetCurrency === 'string'
      ? record.params.targetCurrency
      : undefined

    applyQuoteProjection(record, {
      cryptoCurrency,
      fiatCurrencies: FIAT_TARGET_CURRENCIES,
      sourceAmount,
      targetAmount,
      targetCurrency,
    })
  }

  const streamTransactionQuoteCsv: StreamCsv = async (request, response, context) => {
    const ensuredRequest = enforceDefaultFilters(request)
    const { Filter, flat, populator } = adminModule
    const { currentAdmin, resource } = context

    const unflattenedQuery = flat.unflatten(ensuredRequest.query ?? {}) as ActionQueryParameters
    const filters = unflattenedQuery.filters ?? {}
    const sortBy = typeof unflattenedQuery.sortBy === 'string' && unflattenedQuery.sortBy.length > 0
      ? unflattenedQuery.sortBy
      : 'transactionCreatedAt'
    const direction = unflattenedQuery.direction === 'asc' ? 'asc' : 'desc'

    const filter = await new Filter(filters, resource).populate(context)
    const total = await resource.count(filter, context)

    const decoratedResource = resource.decorate()
    const columns = [...TRANSACTION_QUOTE_LIST_COLUMNS]
    const headerMap = Object.fromEntries(
      columns.map((propertyName) => {
        const property = decoratedResource.getPropertyByKey(propertyName)
        return [propertyName, property?.label() ?? propertyName] as const
      }),
    )

    const rows: Array<Array<unknown>> = [columns.map(column => headerMap[column])]

    if (total > 0) {
      const records = await resource.find(
        filter,
        { limit: total, offset: 0, sort: { direction, sortBy } },
        context,
      )
      const populatedRecords = await populator(records, context)

      for (const record of populatedRecords) {
        const recordJson = record.toJSON(currentAdmin) as { params: Record<string, unknown> }
        await enrichRecord(recordJson)
        rows.push(columns.map(column => recordJson.params[column] ?? ''))
      }
    }

    const csvContent = rows.map(row => row.map(escapeCsvValue).join(',')).join('\n')
    response.setHeader('Content-Type', 'text/csv; charset=utf-8')
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="transaction-quote-detailed-view.csv"',
    )
    response.send(`\uFEFF${csvContent}`)
  }

  const baseResource: AdminResourceConfig = {
    options: {
      actions: {
        delete: { isAccessible: false },
        edit: { isAccessible: false },
        export: {
          before: enforceDefaultFilters,
          isAccessible: true,
        },
        list: {
          before: enforceDefaultFilters,
          isAccessible: true,
        },
        new: { isAccessible: false },
        show: { isAccessible: true },
      },
      properties: {
        id: {
          isId: true,
          isVisible: { edit: false, filter: true, list: true, show: true },
        },
      },
      sort: {
        direction: 'desc',
        sortBy: 'transactionCreatedAt',
      },
    },
    resource: {
      client: prisma,
      model: transactionQuoteViewModel,
    },
  }

  const detailedResource: AdminResourceConfig = {
    options: {
      actions: {
        delete: { isAccessible: false },
        downloadCsv: {
          actionType: 'resource',
          component: false,
          handler: async (request: ActionRequest, _response: Response, context: ActionContext) => {
            const ensuredRequest = enforceDefaultFilters(request)
            const searchParams = buildSearchParams(ensuredRequest)
            const search = searchParams.length > 0 ? `?${searchParams}` : ''
            const redirectUrl = context.h.urlBuilder(
              TRANSACTION_QUOTE_CSV_ROUTE_SEGMENTS,
              search,
            )

            return {
              notice: { message: 'Starting CSV download…', type: 'success' },
              redirectUrl,
            }
          },

          icon: 'Download',
          isAccessible: true,
          isVisible: true,
          label: 'Download CSV',
        },
        edit: { isAccessible: false },
        list: {
          after: async (response: ActionResponse) => {
            const listResponse = response as ActionResponse & { records?: AdminRecord[] }
            if (Array.isArray(listResponse.records)) {
              await Promise.all(listResponse.records.map(record => enrichRecord(record)))
            }
            return response
          },
          before: enforceDefaultFilters,
          isAccessible: true,
        },
        new: { isAccessible: false },
        show: {
          after: async (response: ActionResponse) => {
            const showResponse = response as ActionResponse & { record?: AdminRecord }
            if (showResponse.record) {
              await enrichRecord(showResponse.record)
            }
            return response
          },
          isAccessible: true,
        },
      },
      id: TRANSACTION_QUOTE_RESOURCE_ID,
      listProperties: [...TRANSACTION_QUOTE_LIST_COLUMNS],
      properties: transactionQuoteProperties,
      sort: {
        direction: 'desc',
        sortBy: 'transactionCreatedAt',
      },
    },
    resource: {
      client: prisma,
      model: transactionQuoteViewModel,
    },
  }

  const createCsvRouteHandler = (admin: AdminJSClass) => async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const resource = admin.findResource(TRANSACTION_QUOTE_RESOURCE_ID)
      if (!resource) {
        res.status(404).send('Resource not found')
        return
      }

      const decorated = resource.decorate()
      const downloadAction = decorated.actions[TRANSACTION_QUOTE_DOWNLOAD_ACTION_NAME]
        ?? decorated.actions.list
      const actionRequest: ActionRequest = {
        method: 'get',
        params: {
          action: TRANSACTION_QUOTE_DOWNLOAD_ACTION_NAME,
          resourceId: decorated.id(),
        },
        query: normalizeQueryParams(req.query),
      }
      const ensuredRequest = enforceDefaultFilters(actionRequest)
      const viewHelpers = new (adminModule.ViewHelpers)({ options: admin.options })
      const session = req.session as unknown as { adminUser?: ActionContext['currentAdmin'] }

      const context: ActionContext = {
        _admin: admin,
        action: downloadAction,
        currentAdmin: session?.adminUser,
        h: viewHelpers,
        resource,
      }

      await streamTransactionQuoteCsv(ensuredRequest, res, context)
    }
    catch (error) {
      next(error)
    }
  }

  return {
    baseResource,
    buildActionRequestSearchParams: buildSearchParams,
    createCsvRouteHandler,
    csvRoute: TRANSACTION_QUOTE_CSV_ROUTE,
    detailedResource,
    downloadActionName: TRANSACTION_QUOTE_DOWNLOAD_ACTION_NAME,
    ensureDefaultTransactionQuoteFilters: enforceDefaultFilters,
    normalizeQueryParams,
    resourceId: TRANSACTION_QUOTE_RESOURCE_ID,
    streamTransactionQuoteCsv,
  }
}
