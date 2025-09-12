import { Partner } from '@prisma/client'

declare global {
  namespace Express {
    interface Request {
      user: Partner // Or the specific type returned by your auth function
    }
  }
}

export { }
