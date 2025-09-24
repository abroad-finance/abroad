// src/admin/admin.ts
import type { ExpressPlugin } from '@adminjs/express'
import type AdminJSClass from 'adminjs'
import type {
  ActionContext,
  ActionRequest,
  ComponentLoader,
  FeatureType,
  RecordActionResponse,
} from 'adminjs'
import type { Express } from 'express'

import { Prisma } from '@prisma/client'
import session from 'express-session'

import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { iocContainer } from '../ioc'
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
let adminInstance: AdminJSClass | undefined

type ImportExportFeatureFn = (options: { componentLoader: ComponentLoader }) => FeatureType
type ImportExportModuleShape = { default: ImportExportFeatureFn }
let ImportExportModule: ImportExportModuleShape | undefined

export async function createAdmin(): Promise<AdminJSClass> {
  if (adminInstance) {
    return adminInstance
  }

  if (!AdminJS) {
    const mod = await dynamicImport<typeof import('adminjs')>('adminjs')
    AdminJSImport = mod
    AdminJS = mod.default
  }

  // Prisma adapter
  await registerPrismaAdapter()

  // Import the import/export feature once
  if (!ImportExportModule) {
    ImportExportModule = (await dynamicImport('@adminjs/import-export')) as ImportExportModuleShape
  }
  const importExportFeature: ImportExportFeatureFn = ImportExportModule!.default

  // -------------------------------
  // SINGLETON ComponentLoader (key!)
  // -------------------------------
  const componentLoader: ComponentLoader = new (AdminJSImport!.ComponentLoader)()

  // Acquire Prisma client
  const databaseProvider = iocContainer.get<IDatabaseClientProvider>(TYPES.IDatabaseClientProvider)
  const prisma = await databaseProvider.getClient()

  const getModel = (modelName: string) => {
    const model = Prisma.dmmf.datamodel.models.find(m => m.name === modelName)
    if (!model) {
      throw new Error(`Prisma model not found: ${modelName}`)
    }
    return model
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

  adminInstance = new AdminJS({
    assetsCDN: determineAssetsCdnUrl(),
    branding: {
      companyName: 'Abroad Admin',
      withMadeWithLove: false,
    },
    componentLoader,
    resources: [
      // TransactionQuoteView
      {
        features: [importExportFeature({ componentLoader })],
        options: {
          actions: {
            delete: { isAccessible: false },
            edit: { isAccessible: false },
            export: { isAccessible: true },
            list: { isAccessible: true },
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

      // PartnerUser
      {
        features: [importExportFeature({ componentLoader })],
        options: {
          actions: {
            delete: { isAccessible: false },
            edit: { isAccessible: true },
            export: { isAccessible: true },
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
        features: [importExportFeature({ componentLoader })],
        options: {
          actions: {
            delete: { isAccessible: false },
            edit: { isAccessible: true },
            export: { isAccessible: true },
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
        features: [importExportFeature({ componentLoader })],
        options: {
          actions: {
            delete: { isAccessible: false },
            edit: { isAccessible: false },
            export: { isAccessible: true },
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
        features: [importExportFeature({ componentLoader })],
        options: {
          actions: {
            delete: { isAccessible: false },
            edit: { isAccessible: false },
            export: { isAccessible: true },
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
        features: [importExportFeature({ componentLoader })],
        options: {
          actions: {
            delete: { isAccessible: false },
            edit: { isAccessible: false },
            export: { isAccessible: true },
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

  return adminInstance
}

// -----------------------------------------------------
// MAIN: initialize AdminJS and mount it on the express app
// -----------------------------------------------------
export async function initAdmin(app: Express) {
  if (!AdminJSExpress) {
    const mod = await dynamicImport<typeof import('@adminjs/express')>('@adminjs/express')
    AdminJSExpress = mod.default
  }

  const admin = await createAdmin()

  // ---------------------------------------------
  // DEV ONLY: build AdminJS frontend on the fly
  // Ensures @adminjs/import-export components exist
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

function determineAssetsCdnUrl(): string {
  const explicitCdn = process.env.ADMINJS_ASSETS_CDN?.trim()
  if (explicitCdn) {
    return removeTrailingSlash(explicitCdn)
  }

  const explicitAppBase = process.env.ADMINJS_PUBLIC_URL?.trim() ?? process.env.APP_BASE_URL?.trim()
  if (explicitAppBase) {
    return `${removeTrailingSlash(explicitAppBase)}/admin-assets`
  }

  const port = process.env.PORT || '3784'
  return `http://localhost:${port}/admin-assets`
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

function removeTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.replace(/\/+$/, '') : value
}
