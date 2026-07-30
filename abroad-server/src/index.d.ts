import type { AuthenticatedPartner } from './modules/partners/application/contracts/IPartnerService'

declare global {
  namespace Express {
    interface Request {
      user: AuthenticatedPartner
    }
  }
}

export { }
