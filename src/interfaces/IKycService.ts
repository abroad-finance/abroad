import { KycStatus } from '@prisma/client'

export interface IKycService {
  getKycStatus({ inquiryId }: { inquiryId: string }): Promise<{ inquiryId: string, kycLink: string, status: KycStatus }>
  startKyc({ userId }: { userId: string }): Promise<{ inquiryId: string, kycLink: string, status: KycStatus }>
}
