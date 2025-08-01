import { Country } from '@prisma/client'

export interface IKycService {
  getKycLink(params: {
    amount: number
    country: Country
    redirectUrl?: string
    userId: string
  }): Promise<null | string>
}
