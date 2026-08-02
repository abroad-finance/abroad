import type { OpsExternalIdentity } from '../opsIdentity'

export interface IOpsIdentityProvider {
  verifyIdToken(idToken: string): Promise<OpsExternalIdentity>
}
