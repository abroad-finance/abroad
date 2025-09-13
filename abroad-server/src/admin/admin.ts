// src/admin/admin.ts
import type { ExpressPlugin } from '@adminjs/express'
import type AdminJSClass from 'adminjs'
import type { ActionContext, ActionRequest } from 'adminjs'
import type { Express } from 'express'

import { Prisma } from '@prisma/client'
import session from 'express-session'

import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { iocContainer } from '../ioc'
import { TYPES } from '../types'

// Use native dynamic import to support ESM-only packages from CJS output
type DynamicImport = <T = unknown>(specifier: string) => Promise<T>
const dynamicImport: DynamicImport = new Function(
  'specifier',
  'return import(specifier)',
) as unknown as DynamicImport

let AdminJSExpress: ExpressPlugin
let AdminJS: typeof AdminJSClass
let AdminJSPrisma: typeof import('@adminjs/prisma') | undefined

// Register the Prisma adapter once
async function registerPrismaAdapter() {
  if (!AdminJSPrisma) {
    AdminJSPrisma
      = await dynamicImport<typeof import('@adminjs/prisma')>('@adminjs/prisma')
  }
  // Support different module shapes (ESM/CJS)
  const Database = AdminJSPrisma.Database ?? AdminJSPrisma.default?.Database
  const Resource = AdminJSPrisma.Resource ?? AdminJSPrisma.default?.Resource
  if (Database && Resource) {
    AdminJS.registerAdapter({ Database, Resource })
  }
  else {
    throw new Error('Failed to load @adminjs/prisma adapter exports')
  }
}

// Restrictive action sets
const readOnlyActions = {
  delete: { isAccessible: false },
  edit: { isAccessible: false },
  list: { isAccessible: true },
  new: { isAccessible: false },
  show: { isAccessible: true },
} as const

const readOnlyButEditable = {
  ...readOnlyActions,
  edit: { isAccessible: true },
} as const

export async function initAdmin(app: Express) {
  if (!AdminJS) {
    const mod = await dynamicImport<typeof import('adminjs')>('adminjs')
    AdminJS = mod.default
  }
  await registerPrismaAdapter()
  if (!AdminJSExpress) {
    const mod
      = await dynamicImport<typeof import('@adminjs/express')>(
        '@adminjs/express',
      )
    AdminJSExpress = mod.default
  }
  const databaseProvider = iocContainer.get<IDatabaseClientProvider>(
    TYPES.IDatabaseClientProvider,
  )
  const prisma = await databaseProvider.getClient()

  const admin = new AdminJS({
    branding: {
      companyName: 'Abroad Admin',
      // 'withMadeWithLove' replaces old 'softwareBrothers'
      withMadeWithLove: false,
    },
    resources: [
      {
        options: {
          actions: {
            ...readOnlyButEditable,
            transactions: {
              actionType: 'record',
              component: false,
              handler: async (
                _req: ActionRequest,
                _res: unknown,
                ctx: ActionContext,
              ) => {
                const partnerUserId = ctx.record?.id() ?? ''
                const qs = new URLSearchParams({
                  'filters.partnerUser': partnerUserId,
                }).toString()
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
        },
        resource: {
          client: prisma,
          model: Prisma.dmmf.datamodel.models.find(
            m => m.name === 'PartnerUser',
          )!,
        },
      },
      {
        options: { actions: readOnlyButEditable },
        resource: {
          client: prisma,
          model: Prisma.dmmf.datamodel.models.find(
            m => m.name === 'PartnerUserKyc',
          )!,
        },
      },
      {
        options: { actions: readOnlyActions },
        resource: {
          client: prisma,
          model: Prisma.dmmf.datamodel.models.find(
            m => m.name === 'Partner',
          )!,
        },
      },
      {
        options: { actions: readOnlyActions },
        resource: {
          client: prisma,
          model: Prisma.dmmf.datamodel.models.find(m => m.name === 'Quote')!,
        },
      },
      {
        options: { actions: readOnlyActions },
        resource: {
          client: prisma,
          model: Prisma.dmmf.datamodel.models.find(
            m => m.name === 'Transaction',
          )!,
        },
      },
      {
        options: { actions: readOnlyActions },
        resource: {
          client: prisma,
          model: Prisma.dmmf.datamodel.models.find(
            m => m.name === 'PendingConversions',
          )!,
        },
      },
    ],
    rootPath: '/admin',
  })

  // Optional simple session auth for /admin
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com'
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin'

  app.use(
    session({
      cookie: { secure: false }, // behind proxy you can set true and trust proxy
      resave: false,
      saveUninitialized: false,
      secret: process.env.SESSION_SECRET || 'keyboard cat',
    }),
  )

  const router = AdminJSExpress.buildAuthenticatedRouter(
    admin,
    {
      authenticate: async (email: string, password: string) => {
        if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
          return { email }
        }
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

  app.use(admin.options.rootPath, router)

  // Small log to indicate the panel is mounted
  console.log(`AdminJS mounted at ${admin.options.rootPath}`)
}
