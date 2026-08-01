import type { RequestAuthentication } from './app/http/authenticationContext'

declare global {
  namespace Express {
    interface Request {
      user?: RequestAuthentication
    }
  }
}

export { }
