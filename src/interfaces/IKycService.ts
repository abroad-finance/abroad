import { KycStatus } from '@prisma/client'

export interface IKycService {
  getKycStatus(params: { inquiryId: string, redirectUrl?: string }): Promise<{ inquiryId: string, kycLink: string, status: KycStatus }>
  startKyc(params: { redirectUrl?: string, userId: string }): Promise<{ inquiryId: string, kycLink: string, status: KycStatus }>
}
