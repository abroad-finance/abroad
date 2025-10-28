// src/admin/admin.ts
import type { ExpressPlugin } from '@adminjs/express'
import type AdminJSClass from 'adminjs'
import type {
  ActionContext,
  ActionQueryParameters,
  ActionRequest,
  ActionResponse,
  ComponentLoader,
  RecordActionResponse,
} from 'adminjs'
import type { Express, Response } from 'express'

import { KycStatus, Prisma } from '@prisma/client'
import session from 'express-session'

import type { PersonaInquiryDetails } from '../services/PersonaInquiryDetailsService'

import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { ISecretManager } from '../interfaces/ISecretManager'
import { iocContainer } from '../ioc'
import { PersonaInquiryDetailsService } from '../services/PersonaInquiryDetailsService'
import { TYPES } from '../types'

// -----------------------
// ESM-safe dynamic import
// -----------------------
type DynamicImport = <T = unknown>(specifier: string) => Promise<T>
const dynamicImport: DynamicImport = new Function(
  'specifier',
  'return import(specifier)',
) as unknown as DynamicImport

let AdminJSExpress: ExpressPlugin
let AdminJS: typeof AdminJSClass
let AdminJSPrisma: typeof import('@adminjs/prisma') | undefined
let AdminJSImport: typeof import('adminjs') | undefined

// -----------------------------------------------------
// MAIN: initialize AdminJS and mount it on the express app
// -----------------------------------------------------
export async function initAdmin(app: Express) {
  // Load AdminJS & Express adapter
  if (!AdminJS) {
    const mod = await dynamicImport<typeof import('adminjs')>('adminjs')
    AdminJSImport = mod
    AdminJS = mod.default
  }
  if (!AdminJSExpress) {
    const mod = await dynamicImport<typeof import('@adminjs/express')>('@adminjs/express')
    AdminJSExpress = mod.default
  }

  // Prisma adapter
  await registerPrismaAdapter()

  // -------------------------------
  // SINGLETON ComponentLoader (key!)
  // -------------------------------
  const componentLoader: ComponentLoader = new (AdminJSImport!.ComponentLoader)()

  // Acquire Prisma client
  const databaseProvider = iocContainer.get<IDatabaseClientProvider>(TYPES.IDatabaseClientProvider)
  const prisma = await databaseProvider.getClient()
  const secretManager = iocContainer.get<ISecretManager>(TYPES.ISecretManager)
  const personaInquiryDetailsService = new PersonaInquiryDetailsService(secretManager)

  type AdminRecord = { params: Record<string, unknown> }

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

  const getModel = (modelName: string) => {
    const model = Prisma.dmmf.datamodel.models.find(m => m.name === modelName)
    if (!model) {
      throw new Error(`Prisma model not found: ${modelName}`)
    }
    return model
  }

  const DEFAULT_TRANSACTION_QUOTE_CURRENCY = 'COP' as const

  const ensureDefaultTransactionQuoteFilters = <T extends ActionRequest>(request: T): T => {
    const dotNotationKey = 'filters.targetCurrency'
    const normalizedRequest: ActionRequest = { ...request }

    const query = { ...(request.query ?? {}) } as Record<string, unknown>
    const existingDotValue = query[dotNotationKey]
    if (
      existingDotValue === undefined
      || existingDotValue === null
      || String(existingDotValue).length === 0
    ) {
      query[dotNotationKey] = DEFAULT_TRANSACTION_QUOTE_CURRENCY
    }

    const queryFilters = query.filters
    if (queryFilters && typeof queryFilters === 'object' && !Array.isArray(queryFilters)) {
      const filtersObject = queryFilters as Record<string, unknown>
      const currentTargetCurrency = filtersObject.targetCurrency
      if (
        currentTargetCurrency === undefined
        || currentTargetCurrency === null
        || String(currentTargetCurrency).length === 0
      ) {
        filtersObject.targetCurrency = DEFAULT_TRANSACTION_QUOTE_CURRENCY
      }
    }

    normalizedRequest.query = query as ActionRequest['query']

    if (request.payload && typeof request.payload === 'object' && !Array.isArray(request.payload)) {
      const payload = { ...request.payload } as Record<string, unknown>
      if (
        payload[dotNotationKey] === undefined
        || payload[dotNotationKey] === null
        || String(payload[dotNotationKey]).length === 0
      ) {
        payload[dotNotationKey] = DEFAULT_TRANSACTION_QUOTE_CURRENCY
      }
      const payloadFilters = payload.filters
      if (
        !payloadFilters
        || typeof payloadFilters !== 'object'
        || Array.isArray(payloadFilters)
        || !('targetCurrency' in payloadFilters)
      ) {
        payload.filters = {
          ...(typeof payloadFilters === 'object' && payloadFilters && !Array.isArray(payloadFilters)
            ? payloadFilters
            : {}),
          targetCurrency: DEFAULT_TRANSACTION_QUOTE_CURRENCY,
        }
      }

      normalizedRequest.payload = payload as ActionRequest['payload']
    }

    return normalizedRequest as T
  }

  const transactionQuoteViewModel = (() => {
    const baseModel = getModel('TransactionQuoteView')
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

  async function streamTransactionQuoteCsv(
    request: ActionRequest,
    response: Response,
    context: ActionContext,
  ) {
    const ensuredRequest = ensureDefaultTransactionQuoteFilters(request)
    const adminModule = AdminJSImport!
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

    const csvContent = rows.map(row => row.map(v => escapeCsvValue(v)).join(',')).join('\n')
    response.setHeader('Content-Type', 'text/csv; charset=utf-8')
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="transaction-quote-detailed-view.csv"',
    )
    response.send(`\uFEFF${csvContent}`)
  }

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

  // ---------------------
  // Build AdminJS instance
  // ---------------------
  const admin = new AdminJS({
    branding: {
      companyName: 'Abroad Admin',
      withMadeWithLove: false,
    },
    componentLoader,
    locale: {
      language: 'en',
      translations: {
        labels: {
          TransactionQuoteDetailedView: 'Accountant report',
        },
      },
    },
    resources: [
      // TransactionQuoteView
      {
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
      },

      {
        options: {
          actions: {
            delete: { isAccessible: false },
            downloadCsv: {
              actionType: 'resource',
              component: false,
              handler: async (request: ActionRequest, response: Response, context: ActionContext) => {
                const ensuredRequest = ensureDefaultTransactionQuoteFilters(request)
                // If user is already on the view route (GET), stream the file.
                if (ensuredRequest.method === 'get') {
                  await streamTransactionQuoteCsv(ensuredRequest, response, context)
                  return response
                }

                // First click is a POST/XHR → tell the SPA to navigate to the view route (GET).
                const { h, resource } = context
                const search = new URLSearchParams(
                  (ensuredRequest.query ?? {}) as Record<string, string>,
                ).toString()
                const url = h.resourceActionUrl({
                  actionName: 'downloadCsv',
                  resourceId: resource._decorated?.id() || resource.id(),
                  search,
                })

                return {
                  notice: { message: 'Starting CSV download…', type: 'success' },
                  redirectUrl: url,
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
          id: 'TransactionQuoteDetailedView',
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
      },

      // PartnerUser
      {
        options: {
          actions: {
            delete: { isAccessible: false },
            edit: { isAccessible: true },
            list: { isAccessible: true },
            new: { isAccessible: false },
            show: { isAccessible: true },

            // custom record action
            transactions: {
              actionType: 'record',
              component: false, // no custom React UI, just a redirect
              handler: async (
                _req: ActionRequest,
                _res: unknown,
                ctx: ActionContext,
              ): Promise<RecordActionResponse> => {
                const partnerUserId = ctx.record?.id() ?? ''
                const qs = new URLSearchParams({ 'filters.partnerUser': partnerUserId }).toString()
                const url = ctx.h.listUrl('Transaction', `?${qs}`)
                const recordJson = ctx.record?.toJSON(ctx.currentAdmin)
                return { record: recordJson!, redirectUrl: url }
              },
              icon: 'List',
              isAccessible: true,
              isVisible: true,
              label: 'Transactions',
            },
          },
          sort: {
            direction: 'desc',
            sortBy: 'createdAt',
          },
        },
        resource: {
          client: prisma,
          model: getModel('PartnerUser'),
        },
      },

      // PartnerUserKyc
      {
        options: {
          actions: {
            delete: { isAccessible: false },
            edit: { isAccessible: true },
            list: { isAccessible: true },
            new: { isAccessible: false },
            show: { isAccessible: true },
          },
          sort: {
            direction: 'desc',
            sortBy: 'createdAt',
          },
        },
        resource: {
          client: prisma,
          model: getModel('PartnerUserKyc'),
        },
      },

      // Partner
      {
        options: {
          actions: {
            delete: { isAccessible: false },
            edit: { isAccessible: false },
            list: { isAccessible: true },
            new: { isAccessible: false },
            show: { isAccessible: true },
          },
          sort: {
            direction: 'desc',
            sortBy: 'createdAt',
          },
        },
        resource: {
          client: prisma,
          model: getModel('Partner'),
        },
      },

      // Quote
      {
        options: {
          actions: {
            delete: { isAccessible: false },
            edit: { isAccessible: false },
            list: { isAccessible: true },
            new: { isAccessible: false },
            show: { isAccessible: true },
          },
          sort: {
            direction: 'desc',
            sortBy: 'createdAt',
          },
        },
        resource: {
          client: prisma,
          model: getModel('Quote'),
        },
      },

      // Transaction
      {
        options: {
          actions: {
            delete: { isAccessible: false },
            edit: { isAccessible: false },
            list: { isAccessible: true },
            new: { isAccessible: false },
            show: { isAccessible: true },
          },
          sort: {
            direction: 'desc',
            sortBy: 'createdAt',
          },
        },
        resource: {
          client: prisma,
          model: getModel('Transaction'),
        },
      },

    ],
    rootPath: '/admin',
    settings: { defaultPerPage: 50 },
  })

  // ---------------------------------------------
  // DEV ONLY: build AdminJS frontend on the fly
  // ---------------------------------------------
  if (process.env.NODE_ENV === 'development' && process.env.ADMIN_JS_SKIP_BUNDLE !== 'true') {
    await admin.watch()
  }
  else {
    await admin.initialize()
  }

  // ------------------------
  // Session + Auth middleware
  // ------------------------
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com'
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin'

  app.use(
    session({
      cookie: { secure: false }, // set true behind a trusted proxy with HTTPS
      resave: false,
      saveUninitialized: false,
      secret: process.env.SESSION_SECRET || 'keyboard cat',
    }),
  )

  const router = AdminJSExpress.buildAuthenticatedRouter(
    admin,
    {
      authenticate: async (email: string, password: string) => {
        if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) return { email }
        return null
      },
      cookieName: 'adminjs',
      cookiePassword: process.env.SESSION_SECRET || 'keyboard cat',
    },
    null,
    {
      resave: false,
      saveUninitialized: false,
      secret: process.env.SESSION_SECRET || 'keyboard cat',
    },
  )

  // Mount AdminJS
  app.use(admin.options.rootPath, router)

  console.log(`AdminJS mounted at ${admin.options.rootPath}`)
}

// ----------------------------------------
// Ensure Prisma adapter is registered once
// ----------------------------------------
async function registerPrismaAdapter() {
  if (!AdminJSPrisma) {
    AdminJSPrisma = await dynamicImport<typeof import('@adminjs/prisma')>('@adminjs/prisma')
  }
  const PrismaModule = AdminJSPrisma!
  const Database = PrismaModule.Database ?? PrismaModule.default?.Database
  const Resource = PrismaModule.Resource ?? PrismaModule.default?.Resource

  if (Database && Resource) {
    AdminJS.registerAdapter({ Database, Resource })
  }
  else {
    throw new Error('Failed to load @adminjs/prisma adapter exports')
  }
}
