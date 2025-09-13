// src/admin/admin.ts
import type { Express } from 'express'

let AdminJSExpress: any
let AdminJS: any
import { Prisma, PrismaClient } from '@prisma/client'
import session from 'express-session'
// Use native dynamic import to support ESM-only packages from CJS output
const dynamicImport: (specifier: string) => Promise<any> = new Function(
  'specifier',
  'return import(specifier)',
) as unknown as (specifier: string) => Promise<any>
let AdminJSPrisma: any

// Register the Prisma adapter once
async function registerPrismaAdapter() {
  if (!AdminJSPrisma) {
    AdminJSPrisma = await dynamicImport('@adminjs/prisma')
  }
  // Support different module shapes (ESM/CJS)
  const Database = AdminJSPrisma.Database ?? AdminJSPrisma.default?.Database
  const Resource = AdminJSPrisma.Resource ?? AdminJSPrisma.default?.Resource
  if (Database && Resource) {
    AdminJS.registerAdapter({ Database, Resource })
  }
  else {
    // As a last resort, try registering the module itself
    AdminJS.registerAdapter((AdminJSPrisma.default ?? AdminJSPrisma))
  }
}

// Simple field filtering to avoid showing secrets by default
const defaultActions = {
  delete: { isAccessible: true },
  edit: { isAccessible: true },
  list: { isAccessible: true },
  new: { isAccessible: true },
  show: { isAccessible: true },
} as const

export async function initAdmin(app: Express) {
  if (!AdminJS) {
    const mod = await dynamicImport('adminjs')
    AdminJS = mod.default ?? mod
  }
  await registerPrismaAdapter()
  if (!AdminJSExpress) {
    const mod = await dynamicImport('@adminjs/express')
    AdminJSExpress = mod.default ?? mod
  }
  // Use local PrismaClient directly for AdminJS (read-only usage ok). If the
  // project enforces a single provider, we could import and reuse it, but the
  // provider requires async secret fetch; here we rely on env DATABASE_URL.
  const prisma = new PrismaClient()

  const admin = new AdminJS({
    branding: {
      companyName: 'Abroad Admin',
      // 'withMadeWithLove' replaces old 'softwareBrothers'
      withMadeWithLove: false,
    },
    resources: [
      { options: { actions: defaultActions }, resource: { client: prisma, model: Prisma.dmmf.datamodel.models.find(m => m.name === 'Partner')! } },
      { options: { actions: defaultActions }, resource: { client: prisma, model: Prisma.dmmf.datamodel.models.find(m => m.name === 'PartnerUser')! } },
      { options: { actions: defaultActions }, resource: { client: prisma, model: Prisma.dmmf.datamodel.models.find(m => m.name === 'PartnerUserKyc')! } },
      { options: { actions: defaultActions }, resource: { client: prisma, model: Prisma.dmmf.datamodel.models.find(m => m.name === 'Quote')! } },
      { options: { actions: defaultActions }, resource: { client: prisma, model: Prisma.dmmf.datamodel.models.find(m => m.name === 'Transaction')! } },
      { options: { actions: defaultActions }, resource: { client: prisma, model: Prisma.dmmf.datamodel.models.find(m => m.name === 'StellarListenerState')! } },
      { options: { actions: defaultActions }, resource: { client: prisma, model: Prisma.dmmf.datamodel.models.find(m => m.name === 'SolanaListenerState')! } },
      { options: { actions: { list: { isAccessible: true }, show: { isAccessible: true } } }, resource: { client: prisma, model: Prisma.dmmf.datamodel.models.find(m => m.name === 'PendingConversions')! } },
      { options: { actions: defaultActions }, resource: { client: prisma, model: Prisma.dmmf.datamodel.models.find(m => m.name === 'PaymentProvider')! } },
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
