import { KycStatus } from '@prisma/client'
import axios from 'axios'
import { inject } from 'inversify'

import { IKycService } from '../interfaces/IKycService'
import { ISecretManager } from '../interfaces/ISecretManager'
import { TYPES } from '../types'

type PersonaKycResponse = {
  data: {
    attributes: { status: 'approved' | 'completed' | 'created' | 'declined' | 'expired' | 'failed' | 'needs_review' | 'pending' }
    id: string
  }
}

const mapPersonaStatus = (status: PersonaKycResponse['data']['attributes']['status']): KycStatus => {
  switch (status) {
    case 'approved':
    case 'completed':
      return KycStatus.APPROVED
    case 'created':
    case 'needs_review':
    case 'pending':
      return KycStatus.PENDING
    case 'declined':
    case 'expired':
    case 'failed':
      return KycStatus.REJECTED
  }
}

export class PersonaKycService implements IKycService {
  public constructor(
    @inject(TYPES.ISecretManager) private readonly secretManager: ISecretManager,
  ) {}

  /** Retrieve the latest status for an existing inquiry */
  public async getKycStatus(
    {
      inquiryId,
      redirectUrl,
    }: {
      inquiryId: string
      /** where Persona should send the user once they finish (same URL you used when you started the KYC flow) */
      redirectUrl: string
    },
  ): Promise<{ inquiryId: string, kycLink: string, status: KycStatus }> {
    const personaApiKey = await this.secretManager.getSecret('PERSONA_API_KEY')

    const { data } = await axios.get<PersonaKycResponse>(
      `https://api.withpersona.com/api/v1/inquiries/${inquiryId}`,
      {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${personaApiKey}`,
          'Content-Type': 'application/json',
          'Persona-Version': '2023-01-05',
        },
      },
    )

    const status = mapPersonaStatus(data.data.attributes.status)

    const kycLink
      = `https://withpersona.com/verify?inquiry-id=${inquiryId}`
        + `&redirect-uri=${encodeURIComponent(redirectUrl)}`

    return { inquiryId, kycLink, status }
  }

  /** Start a brand‑new KYC inquiry for the given user */
  public async startKyc(
    {
      redirectUrl,
      userId,
    }: {
      /** where Persona should redirect when the user is done */
      redirectUrl: string
      userId: string
    },
  ): Promise<{ inquiryId: string, kycLink: string, status: KycStatus }> {
    const [inquiryTemplateId, personaApiKey] = await Promise.all([
      this.secretManager.getSecret('PERSONA_INQUIRY_TEMPLATE_ID'),
      this.secretManager.getSecret('PERSONA_API_KEY'),
    ])

    const { data } = await axios.post<PersonaKycResponse>(
      'https://api.withpersona.com/api/v1/inquiries',
      {
        data: {
          attributes: {
            'inquiry-template-id': inquiryTemplateId,
            'redirect-uri': redirectUrl, // <-- tell Persona to use this callback
          },
          meta: {
            'auto-create-account-reference-id': userId,
          },
        },
      },
      {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${personaApiKey}`,
          'Content-Type': 'application/json',
          'Persona-Version': '2023-01-05',
        },
      },
    )

    const inquiryId = data.data.id
    const status = mapPersonaStatus(data.data.attributes.status)

    const kycLink
      = `https://withpersona.com/verify?inquiry-id=${inquiryId}`
        + `&redirect-uri=${encodeURIComponent(redirectUrl)}`

    return { inquiryId, kycLink, status }
  }
}
