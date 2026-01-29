import type { KycCountry } from '../kycTierRules'

export interface IKycService {
  getKycLink(params: {
    amount: number
    country: KycCountry
    redirectUrl?: string
    userId: string
  }): Promise<null | string>
}
