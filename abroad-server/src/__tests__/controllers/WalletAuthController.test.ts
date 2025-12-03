import type { ISecretManager, Secret } from '../../interfaces/ISecretManager'

let WalletAuthController: typeof import('../../controllers/WalletAuthController').WalletAuthController
let stellarSdk: typeof import('@stellar/stellar-sdk')
let buildChallengeTxMock: jest.Mock
let verifyChallengeTxSignersMock: jest.Mock
let fromSecretMock: jest.Mock
let verifyMock: jest.Mock
let signMock: jest.Mock

class SecretManagerStub implements ISecretManager {
  constructor(private readonly secrets: Partial<Record<Secret, string>> = {}) { }

  async getSecret(name: Secret): Promise<string> {
    const value = this.secrets[name]
    if (value) return value
    throw new Error(`Missing secret: ${name}`)
  }

  async getSecrets<T extends readonly Secret[]>(secretNames: T): Promise<Record<T[number], string>> {
    return secretNames.reduce<Record<T[number], string>>((acc, name) => {
      const key = name as T[number]
      acc[key] = this.secrets[key] ?? `secret-${key}`
      return acc
    }, {} as Record<T[number], string>)
  }
}

describe('WalletAuthController', () => {
  let controller: InstanceType<typeof WalletAuthController>
  let secretManager: SecretManagerStub

  beforeEach(async () => {
    jest.resetModules()
    jest.doMock('@stellar/stellar-sdk', () => {
      buildChallengeTxMock = jest.fn().mockReturnValue('challenge-xdr')
      verifyChallengeTxSignersMock = jest.fn().mockReturnValue(['GABC'])
      fromSecretMock = jest.fn().mockReturnValue({ publicKey: jest.fn().mockReturnValue('GSECRET') })
      return {
        Keypair: { fromSecret: fromSecretMock },
        WebAuth: {
          buildChallengeTx: buildChallengeTxMock,
          verifyChallengeTxSigners: verifyChallengeTxSignersMock,
        },
      }
    })
    jest.doMock('jsonwebtoken', () => {
      verifyMock = jest.fn()
      signMock = jest.fn()
      return {
        sign: (...args: unknown[]) => signMock(...args),
        verify: (...args: unknown[]) => verifyMock(...args),
      }
    })

    stellarSdk = await import('@stellar/stellar-sdk')
    const controllerModule = await import('../../controllers/WalletAuthController')
    WalletAuthController = controllerModule.WalletAuthController

    secretManager = new SecretManagerStub({
      STELLAR_HOME_DOMAIN: 'home.domain',
      STELLAR_NETWORK_PASSPHRASE: 'passphrase',
      STELLAR_PRIVATE_KEY: 'PRIVATE_KEY',
      STELLAR_SEP_JWT_SECRET: 'jwt-secret',
      STELLAR_WEB_AUTH_DOMAIN: 'auth.domain',
    })
    controller = new WalletAuthController(secretManager)
    verifyMock.mockReturnValue({ signers: ['GABC'], sub: 'GABC' })
    signMock.mockReturnValue('new-token')
    verifyChallengeTxSignersMock.mockReturnValue(['GABC'])
  })

  it('builds and returns a challenge transaction', async () => {
    const response = await controller.challenge({ address: 'GABC' })

    expect(response).toEqual({ xdr: 'challenge-xdr' })
    expect(buildChallengeTxMock).toHaveBeenCalledWith(
      expect.anything(),
      'GABC',
      'home.domain',
      300,
      'passphrase',
      'auth.domain',
    )
    expect(fromSecretMock).toHaveBeenCalledWith('PRIVATE_KEY')
  })

  it('refreshes a token when verification succeeds', async () => {
    verifyMock.mockReturnValue({ signers: ['GABC'], sub: 'GABC' })
    signMock.mockReturnValue('refreshed-token')

    const result = await controller.refresh({ token: 'old-token' })

    expect(verifyMock).toHaveBeenCalledWith('old-token', 'jwt-secret', { ignoreExpiration: true })
    expect(signMock).toHaveBeenCalledWith({ signers: ['GABC'], sub: 'GABC' }, 'jwt-secret', { expiresIn: '1h' })
    expect(result).toEqual({ token: 'refreshed-token' })
  })

  it('returns 401 when refresh verification fails', async () => {
    verifyMock.mockImplementation(() => {
      throw new Error('expired')
    })
    const setStatusSpy = jest.spyOn(controller, 'setStatus')

    await expect(controller.refresh({ token: 'invalid' })).rejects.toThrow('Invalid token')
    expect(setStatusSpy).toHaveBeenCalledWith(401)
  })

  it('rejects verification when no outstanding challenge exists', async () => {
    const setStatusSpy = jest.spyOn(controller, 'setStatus')
    verifyChallengeTxSignersMock.mockReturnValue(['GABC'])

    await expect(controller.verify({ address: 'GNOPE', signedXDR: 'xdr' })).rejects.toThrow('No outstanding challenge for this account')
    expect(setStatusSpy).toHaveBeenCalledWith(400)
    expect(stellarSdk.WebAuth.verifyChallengeTxSigners).not.toBeUndefined()
  })

  it('rejects verification when client signature is missing', async () => {
    await controller.challenge({ address: 'GABC' })
    verifyChallengeTxSignersMock.mockReturnValue([])
    const setStatusSpy = jest.spyOn(controller, 'setStatus')

    await expect(controller.verify({ address: 'GABC', signedXDR: 'bad-xdr' })).rejects.toThrow('Missing or invalid client signature')
    expect(setStatusSpy).toHaveBeenCalledWith(401)
  })

  it('issues a JWT when the challenge is signed correctly', async () => {
    await controller.challenge({ address: 'GABC' })
    signMock.mockReturnValue('verified-jwt')

    const result = await controller.verify({ address: 'GABC', signedXDR: 'good-xdr' })

    expect(verifyChallengeTxSignersMock).toHaveBeenCalledWith(
      'good-xdr',
      'GSECRET',
      'passphrase',
      ['GABC'],
      'home.domain',
      'auth.domain',
    )
    expect(signMock).toHaveBeenCalledWith({ signers: ['GABC'], sub: 'GABC' }, 'jwt-secret', { expiresIn: '1h' })
    expect(result).toEqual({ token: 'verified-jwt' })
  })
})
