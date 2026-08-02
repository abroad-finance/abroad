import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

import type { ISecretManager } from '../../../../platform/secrets/ISecretManager'

import { OpsAuthenticationError } from '../../../../modules/operations/application/opsIdentity'
import { FirebaseOpsIdentityProvider } from '../../../../modules/operations/infrastructure/FirebaseOpsIdentityProvider'

const mockVerifyIdToken = jest.fn()

jest.mock('firebase-admin/app', () => ({
  getApps: jest.fn(() => []),
  initializeApp: jest.fn(() => ({ name: 'abroad-ops-identity' })),
}))

jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(() => ({ verifyIdToken: mockVerifyIdToken })),
}))

const decodedToken = {
  auth_time: 1_785_681_600,
  email: 'Operator@Abroad.Finance',
  email_verified: true,
  firebase: { sign_in_provider: 'google.com' },
  name: 'Ana Operator',
  sub: 'firebase-subject-1',
}

const buildProvider = (): FirebaseOpsIdentityProvider => {
  const secretManager: Pick<ISecretManager, 'getSecret'> = {
    getSecret: jest.fn().mockResolvedValue('abroad-452212'),
  }
  return new FirebaseOpsIdentityProvider(secretManager as ISecretManager)
}

describe('FirebaseOpsIdentityProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVerifyIdToken.mockResolvedValue(decodedToken)
  })

  it('maps a verified Google Firebase token to a normalized external identity', async () => {
    const provider = buildProvider()

    await expect(provider.verifyIdToken(' firebase-token ')).resolves.toEqual({
      authTime: new Date(decodedToken.auth_time * 1_000),
      displayName: decodedToken.name,
      email: decodedToken.email.toLowerCase(),
      provider: 'google.com',
      subject: decodedToken.sub,
    })
    expect(mockVerifyIdToken).toHaveBeenCalledWith('firebase-token')
    expect(initializeApp).toHaveBeenCalledWith(
      { projectId: 'abroad-452212' },
      'abroad-ops-identity',
    )
    expect(getAuth).toHaveBeenCalledTimes(1)
  })

  it('reuses the initialized auth client across token verifications', async () => {
    const provider = buildProvider()

    await provider.verifyIdToken('token-one')
    await provider.verifyIdToken('token-two')

    expect(getApps).toHaveBeenCalledTimes(1)
    expect(getAuth).toHaveBeenCalledTimes(1)
    expect(mockVerifyIdToken).toHaveBeenCalledTimes(2)
  })

  it.each([
    { label: 'empty token', token: '' },
    { label: 'unverified token', token: 'invalid-token' },
  ])('rejects an $label without leaking provider details', async ({ token }) => {
    const provider = buildProvider()
    if (token) {
      mockVerifyIdToken.mockRejectedValueOnce(new Error('provider detail'))
    }

    await expect(provider.verifyIdToken(token)).rejects.toEqual(
      new OpsAuthenticationError(),
    )
  })

  it('rejects non-Google or unverified identities', async () => {
    const provider = buildProvider()
    mockVerifyIdToken.mockResolvedValueOnce({
      ...decodedToken,
      firebase: { sign_in_provider: 'password' },
    })

    await expect(provider.verifyIdToken('token')).rejects.toBeInstanceOf(
      OpsAuthenticationError,
    )

    mockVerifyIdToken.mockResolvedValueOnce({
      ...decodedToken,
      email_verified: false,
    })
    await expect(provider.verifyIdToken('token')).rejects.toBeInstanceOf(
      OpsAuthenticationError,
    )
  })
})
