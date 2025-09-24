/* scripts/build-admin-assets.ts
 * Builds AdminJS frontend assets in production mode and copies them into the public CDN folder.
 */
import fs from 'fs/promises'
import path from 'path'

import type { ISecretManager, Secret } from '../src/interfaces/ISecretManager'
import { createAdmin } from '../src/admin/admin'
import { iocContainer } from '../src/ioc'
import { TYPES } from '../src/types'

// Ensure the AdminJS bundler runs exactly as in production.
process.env.NODE_ENV = 'production'

class EnvSecretManager implements ISecretManager {
  async getSecret(secretName: Secret): Promise<string> {
    const value = process.env[secretName]
    if (!value) {
      throw new Error(`Missing environment variable for secret "${secretName}".`)
    }
    return value
  }

  async getSecrets<T extends readonly Secret[]>(secretNames: T): Promise<Record<T[number], string>> {
    const entries = await Promise.all(secretNames.map(async secretName => [secretName, await this.getSecret(secretName)] as const))
    return Object.fromEntries(entries) as Record<T[number], string>
  }
}

async function ensureEnvDefaults() {
  const fallbackDatabaseUrl = 'postgresql://local:local@localhost:5432/local'
  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = fallbackDatabaseUrl
  }
}

async function buildAssets() {
  await ensureEnvDefaults()

  // Replace the default secret manager with the environment-backed implementation.
  if (iocContainer.isBound(TYPES.ISecretManager)) {
    iocContainer.unbind(TYPES.ISecretManager)
  }
  iocContainer.bind<ISecretManager>(TYPES.ISecretManager).toConstantValue(new EnvSecretManager())

  const admin = await createAdmin()
  await admin.initialize()

  const projectRoot = path.resolve(__dirname, '..')
  const adminBundlePath = path.join(projectRoot, '.adminjs', 'bundle.js')
  const publicDir = path.join(projectRoot, 'public')

  await fs.mkdir(publicDir, { recursive: true })

  const resolveFromNodeModules = (...segments: string[]) => resolveAsset(projectRoot, segments)

  const copies = [
    {
      destination: path.join(publicDir, 'components.bundle.js'),
      source: adminBundlePath,
    },
    {
      destination: path.join(publicDir, 'app.bundle.js'),
      source: await resolveFromNodeModules('adminjs', 'lib', 'frontend', 'assets', 'scripts', 'app-bundle.production.js'),
    },
    {
      destination: path.join(publicDir, 'global.bundle.js'),
      source: await resolveFromNodeModules('adminjs', 'lib', 'frontend', 'assets', 'scripts', 'global-bundle.production.js'),
    },
    {
      destination: path.join(publicDir, 'design-system.bundle.js'),
      source: await resolveFromNodeModules('adminjs', 'node_modules', '@adminjs', 'design-system', 'bundle.production.js'),
    },
  ] as const

  for (const { source, destination } of copies) {
    await fs.copyFile(source, destination)
  }

  console.log(`AdminJS assets written to ${publicDir}`)
}

async function resolveAsset(projectRoot: string, segments: string[]): Promise<string> {
  const candidates = [
    path.join(projectRoot, 'node_modules', ...segments),
    path.join(projectRoot, '..', 'node_modules', ...segments),
  ]

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  throw new Error(`Asset not found in node_modules: ${segments.join('/')}`)
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  }
  catch {
    return false
  }
}

void buildAssets().catch((error) => {
  console.error('Failed to build AdminJS assets:', error)
  process.exitCode = 1
})
