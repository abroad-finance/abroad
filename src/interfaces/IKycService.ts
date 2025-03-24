import { KycStatus } from '@prisma/client'

export interface IKycService {
  getKycStatus(userId: string): Promise<{ kycLink: string, status: KycStatus }>
}
