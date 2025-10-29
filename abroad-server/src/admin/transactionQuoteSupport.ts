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

import type { PersonaInquiryDetails } from '../services/PersonaInquiryDetailsService'
import type { PersonaInquiryDetailsService } from '../services/PersonaInquiryDetailsService'

type AdminModule = typeof import('adminjs')
type AdminRecord = { params: Record<string, unknown> }
type AdminResourceConfig = NonNullable<AdminJSOptions['resources']>[number]

const TRANSACTION_QUOTE_LIST_COLUMNS = [
  'fecha',
  'tipoDocumento',
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
  const fiatTargetCurrencies = new Set(['BRL', 'COP'])

  const parseNumber = (value: unknown): null | number => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'string') {
      const normalised = value.replace(/,/g, '')
      const parsed = Number(normalised)
      return Number.isFinite(parsed) ? parsed : null
    }
    return null
  }

  const formatAmount = (value: null | number): string => {
    if (value === null || Number.isNaN(value)) return ''
    try {
      return value.toLocaleString('es-CO', {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      })
    }
    catch {
      return value.toFixed(2)
    }
  }

  const formatDateTime = (value: unknown): string => {
    if (!value) return ''
    const date = value instanceof Date ? value : new Date(String(value))
    if (Number.isNaN(date.getTime())) return ''
    return date.toISOString().replace('T', ' ').slice(0, 16)
  }

  const getOperationLabel = (targetCurrency: unknown): string => {
    const currency = typeof targetCurrency === 'string' ? targetCurrency.toUpperCase() : ''
    return fiatTargetCurrencies.has(currency) ? 'Venta' : 'Compra'
  }

  const escapeCsvValue = (value: unknown): string => {
    if (value === null || value === undefined) return ''
    if (value instanceof Date) return value.toISOString()
    const stringValue = typeof value === 'object' ? JSON.stringify(value) : String(value)
    return /[",\n\r]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue
  }

  const ensurePersonaFields = (record: AdminRecord, persona: null | PersonaInquiryDetails) => {
    record.params.tipoDocumento = persona?.documentType ?? ''
    record.params.nombreRazonSocial = persona?.fullName ?? ''
    record.params.direccion = persona?.address ?? ''
    record.params.telefono = persona?.phone ?? ''
    record.params.email = persona?.email ?? ''
    record.params.pais = persona?.country ?? ''
    record.params.departamento = persona?.department ?? ''
    record.params.municipio = persona?.city ?? ''
  }

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

    ensurePersonaFields(record, personaDetails)

    record.params.fecha = formatDateTime(record.params.transactionCreatedAt)

    const targetAmount = parseNumber(record.params.targetAmount)
    const sourceAmount = parseNumber(record.params.sourceAmount)
    const cryptoCurrency = typeof record.params.cryptoCurrency === 'string'
      ? record.params.cryptoCurrency
      : undefined
    const targetCurrency = typeof record.params.targetCurrency === 'string'
      ? record.params.targetCurrency
      : undefined

    const montoCop = targetCurrency === 'COP' ? formatAmount(targetAmount) : ''
    const montoUsdc = cryptoCurrency === 'USDC' ? formatAmount(sourceAmount) : ''

    record.params.montoCop = montoCop
    record.params.montoUsdc = montoUsdc

    const trmValue = targetAmount !== null && sourceAmount !== null && sourceAmount !== 0
      ? targetAmount / sourceAmount
      : null

    record.params.trm = formatAmount(trmValue)
    record.params.hashTransaccion = typeof record.params.onChainId === 'string' ? record.params.onChainId : ''
    record.params.tipoOperacion = getOperationLabel(targetCurrency)
  }

  const ensureDefaultTransactionQuoteFilters = <T extends ActionRequest>(request: T): T => {
    const currencyDotNotationKey = 'filters.targetCurrency'
    const statusDotNotationKey = 'filters.transactionStatus'
    const normalizedRequest: ActionRequest = { ...request }

    const query = { ...(request.query ?? {}) } as Record<string, unknown>
    const isMissing = (value: unknown) =>
      value === undefined || value === null || String(value).length === 0
    const normalizeFilters = (value: unknown): Record<string, unknown> => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return { ...(value as Record<string, unknown>) }
      }
      return {}
    }

    if (isMissing(query[currencyDotNotationKey])) {
      query[currencyDotNotationKey] = DEFAULT_TRANSACTION_QUOTE_CURRENCY
    }
    query[statusDotNotationKey] = DEFAULT_TRANSACTION_QUOTE_STATUS

    const queryFilters = normalizeFilters(query.filters)
    if (isMissing(queryFilters.targetCurrency)) {
      queryFilters.targetCurrency = DEFAULT_TRANSACTION_QUOTE_CURRENCY
    }
    queryFilters.transactionStatus = DEFAULT_TRANSACTION_QUOTE_STATUS
    query.filters = queryFilters

    normalizedRequest.query = query as ActionRequest['query']

    if (request.payload && typeof request.payload === 'object' && !Array.isArray(request.payload)) {
      const payload = { ...request.payload } as Record<string, unknown>
      if (isMissing(payload[currencyDotNotationKey])) {
        payload[currencyDotNotationKey] = DEFAULT_TRANSACTION_QUOTE_CURRENCY
      }
      payload[statusDotNotationKey] = DEFAULT_TRANSACTION_QUOTE_STATUS

      const payloadFilters = normalizeFilters(payload.filters)
      if (isMissing(payloadFilters.targetCurrency)) {
        payloadFilters.targetCurrency = DEFAULT_TRANSACTION_QUOTE_CURRENCY
      }
      payloadFilters.transactionStatus = DEFAULT_TRANSACTION_QUOTE_STATUS
      payload.filters = payloadFilters

      normalizedRequest.payload = payload as ActionRequest['payload']
    }

    return normalizedRequest as T
  }

  const flattenActionParams = (input?: Record<string, unknown>): Array<[string, string]> => {
    if (!input) return []
    const { flat } = adminModule
    const flattened = flat.flatten(input) as Record<string, unknown>
    const entries: Array<[string, string]> = []

    for (const [key, value] of Object.entries(flattened)) {
      if (value === undefined || value === null) continue
      if (Array.isArray(value)) {
        value.forEach(item => entries.push([key, String(item)]))
        continue
      }
      entries.push([key, String(value)])
    }

    return entries
  }

  const buildActionRequestSearchParams = (request: ActionRequest): string => {
    const params = new URLSearchParams()

    for (const [key, value] of flattenActionParams(request.payload as Record<string, unknown> | undefined)) {
      params.set(key, value)
    }

    for (const [key, value] of flattenActionParams(request.query as Record<string, unknown> | undefined)) {
      params.set(key, value)
    }

    return params.toString()
  }

  const streamTransactionQuoteCsv: StreamCsv = async (request, response, context) => {
    const ensuredRequest = ensureDefaultTransactionQuoteFilters(request)
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

  const normalizeQueryParams = (rawQuery: Request['query']): Record<string, unknown> => {
    const normalized: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(rawQuery ?? {})) {
      if (Array.isArray(value)) {
        if (value.length > 0) {
          normalized[key] = value[value.length - 1]
        }
        continue
      }
      if (value !== undefined) {
        normalized[key] = value as unknown
      }
    }

    return normalized
  }

  const baseResource: AdminResourceConfig = {
    options: {
      actions: {
        delete: { isAccessible: false },
        edit: { isAccessible: false },
        export: {
          before: ensureDefaultTransactionQuoteFilters,
          isAccessible: true,
        },
        list: {
          before: ensureDefaultTransactionQuoteFilters,
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
            const ensuredRequest = ensureDefaultTransactionQuoteFilters(request)
            const searchParams = buildActionRequestSearchParams(ensuredRequest)
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
          before: ensureDefaultTransactionQuoteFilters,
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
      properties: {
        departamento: {
          isSortable: false,
          isVisible: { edit: false, filter: true, list: true, show: true },
          label: 'Departamento',
          position: 80,
          type: 'string',
        },
        direccion: {
          isSortable: false,
          isVisible: { edit: false, filter: false, list: true, show: true },
          label: 'Dirección',
          position: 40,
          type: 'string',
        },
        email: {
          isSortable: false,
          isVisible: { edit: false, filter: true, list: true, show: true },
          label: 'Email',
          position: 60,
          type: 'string',
        },
        fecha: {
          isSortable: false,
          isVisible: { edit: false, filter: true, list: true, show: true },
          label: 'Fecha',
          position: 10,
          type: 'string',
        },
        hashTransaccion: {
          isSortable: false,
          isVisible: { edit: false, filter: true, list: true, show: true },
          label: 'Hash de la transacción',
          position: 130,
          type: 'string',
        },
        id: {
          isId: true,
          isVisible: { edit: false, filter: true, list: true, show: true },
        },
        montoCop: {
          isSortable: false,
          isVisible: { edit: false, filter: false, list: true, show: true },
          label: 'Monto en COP',
          position: 100,
          type: 'string',
        },
        montoUsdc: {
          isSortable: false,
          isVisible: { edit: false, filter: false, list: true, show: true },
          label: 'Monto en USDC',
          position: 110,
          type: 'string',
        },
        municipio: {
          isSortable: false,
          isVisible: { edit: false, filter: true, list: true, show: true },
          label: 'Municipio',
          position: 90,
          type: 'string',
        },
        nombreRazonSocial: {
          isSortable: false,
          isVisible: { edit: false, filter: true, list: true, show: true },
          label: 'Nombre o Razón Social',
          position: 30,
          type: 'string',
        },
        pais: {
          isSortable: false,
          isVisible: { edit: false, filter: true, list: true, show: true },
          label: 'País',
          position: 70,
          type: 'string',
        },
        telefono: {
          isSortable: false,
          isVisible: { edit: false, filter: false, list: true, show: true },
          label: 'Teléfono',
          position: 50,
          type: 'string',
        },
        tipoDocumento: {
          isSortable: false,
          isVisible: { edit: false, filter: true, list: true, show: true },
          label: 'Tipo de Documento',
          position: 20,
          type: 'string',
        },
        tipoOperacion: {
          isSortable: false,
          isVisible: { edit: false, filter: true, list: true, show: true },
          label: 'Compra o Venta',
          position: 140,
          type: 'string',
        },
        trm: {
          isSortable: false,
          isVisible: { edit: false, filter: false, list: true, show: true },
          label: 'TRM',
          position: 120,
          type: 'string',
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
      const ensuredRequest = ensureDefaultTransactionQuoteFilters(actionRequest)
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
    buildActionRequestSearchParams,
    createCsvRouteHandler,
    csvRoute: TRANSACTION_QUOTE_CSV_ROUTE,
    detailedResource,
    downloadActionName: TRANSACTION_QUOTE_DOWNLOAD_ACTION_NAME,
    ensureDefaultTransactionQuoteFilters,
    normalizeQueryParams,
    resourceId: TRANSACTION_QUOTE_RESOURCE_ID,
    streamTransactionQuoteCsv,
  }
}
