import type { ISecretManager } from '../../interfaces/ISecretManager'

import { PrismaClientProvider } from '../../infrastructure/db'

const prismaInstance = { marker: 'client' } as unknown as import('@prisma/client').PrismaClient
const prismaConstructorCalls: Array<{ datasourceUrl?: null | string }> = []

jest.mock('@prisma/client', () => {
  const PrismaClient = jest.fn((options?: { datasourceUrl?: null | string }) => {
    prismaConstructorCalls.push({ datasourceUrl: options?.datasourceUrl ?? null })
    return prismaInstance
  })
  return { PrismaClient }
})

const { PrismaClient: PrismaClientMock } = jest.requireMock('@prisma/client') as { PrismaClient: jest.Mock }

describe('PrismaClientProvider', () => {
  let secretManager: ISecretManager

  beforeEach(() => {
    prismaConstructorCalls.splice(0, prismaConstructorCalls.length)
    PrismaClientMock.mockClear()
    secretManager = {
      getSecret: jest.fn(async () => 'postgres://from-secret'),
      getSecrets: jest.fn(),
    }
  })

  it('creates a Prisma client with the secret datasource URL and caches it', async () => {
    const provider = new PrismaClientProvider(secretManager)

    const first = await provider.getClient()
    const second = await provider.getClient()

    expect(first).toBe(prismaInstance)
    expect(second).toBe(prismaInstance)
    expect(secretManager.getSecret).toHaveBeenCalledTimes(1)
    expect(PrismaClientMock).toHaveBeenCalledTimes(1)
    expect(prismaConstructorCalls[0]).toEqual({ datasourceUrl: 'postgres://from-secret' })
  })

  it('avoids re-fetching the datasource URL when the client is already cached', async () => {
    const provider = new PrismaClientProvider(secretManager)
    await provider.getClient();

    (secretManager.getSecret as jest.Mock).mockClear()
    PrismaClientMock.mockClear()

    await provider.getClient()

    expect(secretManager.getSecret).not.toHaveBeenCalled()
    expect(PrismaClientMock).not.toHaveBeenCalled()
  })
})
