import type { App } from 'firebase-admin/app'
import type { Auth } from 'firebase-admin/auth'

import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../app/container/types'
import { ISecretManager, Secrets } from '../../../platform/secrets/ISecretManager'
import { IOpsIdentityProvider } from '../application/contracts/IOpsIdentityProvider'
import { OpsAuthenticationError, OpsExternalIdentity } from '../application/opsIdentity'

const FIREBASE_APP_NAME = 'abroad-ops-identity'
const MAX_DISPLAY_NAME_LENGTH = 120

const verifiedGoogleIdentitySchema = z.object({
  auth_time: z.number().int().positive(),
  email: z.string().trim().email().max(254),
  email_verified: z.literal(true),
  firebase: z.object({
    sign_in_provider: z.literal('google.com'),
  }),
  name: z.string().trim().min(1).max(MAX_DISPLAY_NAME_LENGTH).optional(),
  sub: z.string().trim().min(1).max(128),
}).passthrough()

@injectable()
export class FirebaseOpsIdentityProvider implements IOpsIdentityProvider {
  private authPromise: null | Promise<Auth> = null

  public constructor(
    @inject(TYPES.ISecretManager)
    private readonly secretManager: ISecretManager,
  ) {}

  public async verifyIdToken(idToken: string): Promise<OpsExternalIdentity> {
    const normalizedToken = idToken.trim()
    if (!normalizedToken) {
      throw new OpsAuthenticationError()
    }

    try {
      const auth = await this.getFirebaseAuth()
      const decoded = await auth.verifyIdToken(normalizedToken)
      const identity = verifiedGoogleIdentitySchema.parse(decoded)
      return {
        authTime: new Date(identity.auth_time * 1_000),
        displayName: identity.name ?? identity.email.split('@')[0],
        email: identity.email.toLowerCase(),
        provider: 'google.com',
        subject: identity.sub,
      }
    }
    catch {
      throw new OpsAuthenticationError()
    }
  }

  private async createFirebaseAuth(): Promise<Auth> {
    const projectId = await this.secretManager.getSecret(Secrets.GCP_PROJECT_ID)
    const existingApp = getApps().find(app => app.name === FIREBASE_APP_NAME)
    const app: App = existingApp ?? initializeApp({ projectId }, FIREBASE_APP_NAME)
    return getAuth(app)
  }

  private getFirebaseAuth(): Promise<Auth> {
    this.authPromise ??= this.createFirebaseAuth()
    return this.authPromise
  }
}
