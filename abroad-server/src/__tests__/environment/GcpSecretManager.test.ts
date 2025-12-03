import type { Secret } from '../../interfaces/ISecretManager'

import { GcpSecretManager } from '../../environment/GcpSecretManager'

const isAvailableMock = jest.fn()
const projectMock = jest.fn()
const accessSecretVersionMock = jest.fn()

jest.mock('gcp-metadata', () => ({
  isAvailable: () => isAvailableMock(),
  project: () => projectMock(),
}))

jest.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: jest.fn(() => ({
    accessSecretVersion: accessSecretVersionMock,
  })),
}))

describe('GcpSecretManager', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv }
  })

  afterAll(() => {
    process.env = originalEnv
  })

  it('returns environment secrets in development', async () => {
    process.env.NODE_ENV = 'development'
    process.env.MOVII_API_KEY = 'dev-key'
    const manager = new GcpSecretManager()

    const secret = await manager.getSecret('MOVII_API_KEY' as Secret)

    expect(secret).toBe('dev-key')
    expect(accessSecretVersionMock).not.toHaveBeenCalled()
  })

  it('fetches secrets from GCP and caches project id outside development', async () => {
    process.env.NODE_ENV = 'production'
    isAvailableMock.mockResolvedValue(true)
    projectMock.mockResolvedValue('proj-123')
    accessSecretVersionMock.mockResolvedValue([{ payload: { data: Buffer.from('secret-val') } }])
    const manager = new GcpSecretManager()

    const first = await manager.getSecret('MOVII_API_KEY' as Secret)
    const second = await manager.getSecret('GCP_PROJECT_ID')

    expect(first).toBe('secret-val')
    expect(second).toBe('proj-123')
    expect(projectMock).toHaveBeenCalledTimes(1)
    expect(accessSecretVersionMock).toHaveBeenCalledWith({
      name: 'projects/proj-123/secrets/MOVII_API_KEY/versions/latest',
    })
  })

  it('throws when project id is missing in development', async () => {
    process.env.NODE_ENV = 'development'
    delete process.env.PROJECT_ID
    const manager = new GcpSecretManager()

    await expect(manager.getSecret('GCP_PROJECT_ID')).rejects.toThrow('PROJECT_ID is not defined in development mode.')
  })
})
