import { KycStatus, KYCTier } from '@prisma/client'
import axios from 'axios'
import { inject } from 'inversify'

import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { IKycService } from '../interfaces/IKycService'
import { ISecretManager } from '../interfaces/ISecretManager'
import { TYPES } from '../types'

type Country = 'BR' | 'CO'

export class PersonaKycService implements IKycService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider) private dbProvider: IDatabaseClientProvider,
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) { }

  public getKycLink: IKycService['getKycLink'] = async ({
    amount,
    country,
    redirectUrl,
    userId,
  }) => {
    const client = await this.dbProvider.getClient()

    const highestKyc = await client.partnerUserKyc.findFirst({
      orderBy: { createdAt: 'desc' },
      where: { partnerUserId: userId, status: KycStatus.APPROVED },
    })

    const existingTier: KYCTier = highestKyc?.tier ?? KYCTier.NONE
    const nextTier = getNextTier(country, amount, existingTier)
    if (!nextTier) return null

    const inquiryTemplates = await this.getInquiryTemplateIds()
    const templateId = inquiryTemplates[country][nextTier]

    if (!templateId) return null

    const { PERSONA_API_KEY } = await this.secretManager.getSecrets([
      'PERSONA_API_KEY',
    ] as const)

    const inquiryId = await this.createPersonaInquiry({
      apiKey: PERSONA_API_KEY,
      templateId,
      userId,
    })

    const kycLink = this.buildHostedFlowLink(inquiryId, redirectUrl)

    await client.partnerUserKyc.create({
      data: {
        externalId: inquiryId,
        link: kycLink,
        partnerUserId: userId,
        status: KycStatus.PENDING,
        tier: nextTier,
      },
    })

    return kycLink
  }

  private buildHostedFlowLink(inquiryId: string, redirectUrl?: string): string {
    const base = `https://withpersona.com/verify?inquiry-id=${encodeURIComponent(inquiryId)}`
    if (!redirectUrl) return base
    const url = new URL(base)
    // Persona supports redirect via `redirect-uri` on hosted flow
    url.searchParams.set('redirect-uri', redirectUrl)
    return url.toString()
  }

  /* ---------------------------------------------------------------------
   * Helpers
   * ------------------------------------------------------------------- */

  private async createPersonaInquiry(params: {
    apiKey: string
    templateId: string
    userId: string
  }): Promise<string> {
    const { apiKey, templateId, userId } = params

    const { data } = await axios.post(
      'https://withpersona.com/api/v1/inquiries',
      {
        data: {
          attributes: {
            'inquiry-template-id': templateId,
          },
        },
        meta: {
          'auto-create-account-reference-id': userId,
        },
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      },
    )

    const inquiryId: string | undefined = data?.data?.id
    if (!inquiryId) {
      throw new Error('Failed to create Persona inquiry – missing id')
    }
    return inquiryId
  }

  private getInquiryTemplateIds = async (): Promise<Record<Country, Record<KYCTier, null | string>>> => {
    const PERSONA_BASIC_INQUIRY_TEMPLATE_ID = 'itmpl_cV1CxdaysSpkxZfNZs7V1spRM5B1'
    const PERSONA_ENHANCED_INQUIRY_TEMPLATE_ID = 'itmpl_XTXBkm9FEunS9kU7kMav3kh4mSwj'
    return {
      BR: {
        [KYCTier.BASIC]: PERSONA_BASIC_INQUIRY_TEMPLATE_ID,
        [KYCTier.ENHANCED]: PERSONA_ENHANCED_INQUIRY_TEMPLATE_ID,
        [KYCTier.NONE]: null,
        [KYCTier.STANDARD]: null,
      },
      CO: {
        [KYCTier.BASIC]: PERSONA_BASIC_INQUIRY_TEMPLATE_ID,
        [KYCTier.ENHANCED]: PERSONA_ENHANCED_INQUIRY_TEMPLATE_ID,
        [KYCTier.NONE]: null,
        [KYCTier.STANDARD]: null,
      },
    }
  }
}

/* ---------------------------------------------------------------------------
 * Smart workflow resolver
 * ------------------------------------------------------------------------- */
/**
 * Decide whether the user needs to complete an additional Persona KYC tier.
 *
 * @param country        "BR" or "CO"
 * @param amount         Transaction amount (BRL for BR, USD for CO)
 * @param existingTier   Highest KYC tier the user has already passed
 *                       — persist this per‑user in your DB / session.
 * @returns `string | null`
 *          → `workflowDefinitionId` to launch if *more* KYC is needed
 *          → `null` if the existing data already satisfies this operation
 */
export function getNextTier(
  country: Country,
  amount: number,
  existingTier: KYCTier = KYCTier.NONE,
): KYCTier | null {
  if (amount < 0) throw new Error('Amount cannot be negative')

  const requiredTier = tierRule[country](amount)
  if (tierOrder[existingTier] >= tierOrder[requiredTier]) return null

  return requiredTier
}

// Numerical mapping for KYC tier comparison
const tierOrder: Record<KYCTier, number> = {
  [KYCTier.BASIC]: 1,
  [KYCTier.ENHANCED]: 3,
  [KYCTier.NONE]: 0,
  [KYCTier.STANDARD]: 2,
}

/* ---------------------------------------------------------------------------
 * Lookup tables
 *
 * Note: KYCTier enum has numerical ordering for proper comparison
 * ------------------------------------------------------------------------- */
const tierRule: Record<Country, (amount: number) => KYCTier> = {
  BR: amount => amount < 1800 ? KYCTier.BASIC : KYCTier.ENHANCED,
  CO: amount => amount < 10000 ? KYCTier.BASIC : KYCTier.ENHANCED,
}
