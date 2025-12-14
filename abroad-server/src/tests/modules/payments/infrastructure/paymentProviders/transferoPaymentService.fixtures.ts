import axios from 'axios'

import type { IPixQrDecoder } from '../../../../../modules/payments/application/contracts/IQrDecoder'
import type { IDatabaseClientProvider } from '../../../../../platform/persistence/IDatabaseClientProvider'
import type { ISecretManager, Secret } from '../../../../../platform/secrets/ISecretManager'

import { TransferoPaymentService } from '../../../../../modules/payments/infrastructure/paymentProviders/transferoPaymentService'
import { createMockLogger, type MockLogger } from '../../../../setup/mockFactories'

jest.mock('axios')

export const mockedAxios = axios as jest.Mocked<typeof axios>

type PrismaLike = {
  transaction: {
    findUnique: jest.Mock
  }
}

type TransferoSecretKey
  = | 'TRANSFERO_ACCOUNT_ID'
    | 'TRANSFERO_BASE_URL'
    | 'TRANSFERO_CLIENT_ID'
    | 'TRANSFERO_CLIENT_SCOPE'
    | 'TRANSFERO_CLIENT_SECRET'

const DEFAULT_SECRETS: Record<TransferoSecretKey, string> = {
  TRANSFERO_ACCOUNT_ID: 'account-1',
  TRANSFERO_BASE_URL: 'https://transfero.example.com',
  TRANSFERO_CLIENT_ID: 'client-id',
  TRANSFERO_CLIENT_SCOPE: 'payments',
  TRANSFERO_CLIENT_SECRET: 'client-secret',
}

export type TransferoTestHarness = {
  contractBuilder: {
    buildContract: (input: { account: string, qrCode?: null | string, taxId: string, value: number }) => Promise<Array<Record<string, null | number | string>>>
  }
  dbProvider: IDatabaseClientProvider
  logger: MockLogger
  pixDecoder: IPixQrDecoder
  prismaClient: PrismaLike
  secretManager: ISecretManager
  service: TransferoPaymentService
  tokenAccessor: { getAccessToken: () => Promise<string> }
}

export const createSecretManager = (overrides: Partial<Record<TransferoSecretKey, string>> = {}): ISecretManager => {
  const secrets: Record<TransferoSecretKey, string> = { ...DEFAULT_SECRETS, ...overrides }

  return {
    getSecret: jest.fn(async (name: TransferoSecretKey) => secrets[name] ?? ''),
    getSecrets: jest.fn(async <T extends readonly Secret[]>(names: T) => {
      const resolved = names.map((key) => {
        const typedKey = key as TransferoSecretKey
        return [key, secrets[typedKey] ?? ''] as const
      })
      return Object.fromEntries(resolved) as Record<T[number], string>
    }),
  }
}

export const createPrismaClient = (): PrismaLike => ({
  transaction: {
    findUnique: jest.fn(),
  },
})

export const createDbProvider = (prismaClient: PrismaLike): IDatabaseClientProvider => ({
  getClient: jest.fn(async () => prismaClient as unknown as import('@prisma/client').PrismaClient),
})

export const createPixDecoder = (decoder?: jest.Mock): IPixQrDecoder => ({
  decode: decoder ?? jest.fn(async () => ({ name: 'QR Recipient', taxId: 'TAX-QR' })),
})

export const resetAxiosMocks = (): void => {
  mockedAxios.get.mockReset()
  mockedAxios.post.mockReset()
  mockedAxios.isAxiosError.mockReset()
  mockedAxios.isAxiosError.mockReturnValue(false)
}

export const buildTransferoHarness = (options?: {
  pixDecoder?: IPixQrDecoder
  prismaClient?: PrismaLike
  secretManager?: ISecretManager
  secretOverrides?: Partial<Record<TransferoSecretKey, string>>
}): TransferoTestHarness => {
  const prismaClient = options?.prismaClient ?? createPrismaClient()
  const secretManager = options?.secretManager ?? createSecretManager(options?.secretOverrides)
  const pixDecoder = options?.pixDecoder ?? createPixDecoder()
  const logger = createMockLogger()
  const dbProvider = createDbProvider(prismaClient)
  const service = new TransferoPaymentService(secretManager, dbProvider, pixDecoder, logger)

  return {
    contractBuilder: service as unknown as {
      buildContract: (input: { account: string, qrCode?: null | string, taxId: string, value: number }) => Promise<Array<Record<string, null | number | string>>>
    },
    dbProvider,
    logger,
    pixDecoder,
    prismaClient,
    secretManager,
    service,
    tokenAccessor: service as unknown as { getAccessToken: () => Promise<string> },
  }
}
