// src/admin/admin.ts
import type { ExpressPlugin } from '@adminjs/express'
import type AdminJSClass from 'adminjs'
import type { ActionContext, ActionRequest, ComponentLoader, RecordActionResponse } from 'adminjs'
import type { Express } from 'express'

import { Prisma } from '@prisma/client'
import session from 'express-session'

import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { ISecretManager } from '../interfaces/ISecretManager'
import { iocContainer } from '../ioc'
import { PersonaInquiryDetailsService } from '../services/PersonaInquiryDetailsService'
import { TYPES } from '../types'
import { createTransactionQuoteSupport } from './transactionQuoteSupport'

// -----------------------
// ESM-safe dynamic import
// -----------------------
type DynamicImport = <T = unknown>(specifier: string) => Promise<T>
const dynamicImport: DynamicImport = async function dynamicImportImpl<T = unknown>(specifier: string): Promise<T> {
  return import(specifier) as Promise<T>
}

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

  const transactionQuoteSupport = createTransactionQuoteSupport({
    adminModule: AdminJSImport!,
    personaInquiryDetailsService,
    prisma,
  })

  const getModel = (modelName: string) => {
    const model = Prisma.dmmf.datamodel.models.find(m => m.name === modelName)
    if (!model) {
      throw new Error(`Prisma model not found: ${modelName}`)
    }
    return model
  }

  // ---------------------
  // Build AdminJS instance
  // ---------------------
  const buildActions = (allowEdit: boolean, extraActions: Record<string, unknown> = {}) => ({
    delete: { isAccessible: false },
    edit: { isAccessible: allowEdit },
    list: { isAccessible: true },
    new: { isAccessible: false },
    show: { isAccessible: true },
    ...extraActions,
  })

  const createResource = (
    modelName: string,
    allowEdit: boolean,
    extraActions: Record<string, unknown> = {},
  ) => ({
    options: {
      actions: buildActions(allowEdit, extraActions),
      sort: {
        direction: 'desc',
        sortBy: 'createdAt',
      },
    },
    resource: {
      client: prisma,
      model: getModel(modelName),
    },
  })

  const partnerUserTransactionsAction = {
    actionType: 'record',
    component: false,
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
  }

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
      transactionQuoteSupport.baseResource,
      transactionQuoteSupport.detailedResource,
      createResource('PartnerUser', true, { transactions: partnerUserTransactionsAction }),
      createResource('PartnerUserKyc', true),
      createResource('Partner', false),
      createResource('Quote', false),
      createResource('Transaction', false),
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

  router.get(transactionQuoteSupport.csvRoute, transactionQuoteSupport.createCsvRouteHandler(admin))

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
