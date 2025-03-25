import { KycStatus } from '@prisma/client'
import axios from 'axios'
import { inject } from 'inversify'

import { IKycService } from '../interfaces/IKycService'
import { ISecretManager } from '../interfaces/ISecretManager'
import { TYPES } from '../types'

type PersonaKycResponse = {
  data: {
    attributes: {
      status:
        'approved' |
        'completed' |
        'created' |
        'declined' |
        'expired' |
        'failed' |
        'needs_review' |
        'pending'
    }
    id: string
  }
}

export class PersonaKycService implements IKycService {
  public constructor(
        @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) { }

  public async getKycStatus({ inquiryId }: { inquiryId: string }): Promise<{ inquiryId: string, kycLink: string, status: KycStatus }> {
    const personaApiKey: string = await this.secretManager.getSecret('PERSONA_API_KEY')

    // Create a Persona inquiry
    const response = await axios.get(
      `https://api.withpersona.com/api/v1/inquiries/${inquiryId}`,
      {
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${personaApiKey}`,
          'Content-Type': 'application/json',
          'Persona-Version': '2023-01-05',
        },
      },
    ) as { data: PersonaKycResponse }

    const inquiryStatus = response.data.data.attributes.status

    // Convert Persona’s status (e.g. "created", "pending", etc.) to our KycStatus (assuming uppercase values)
    let mappedStatus: KycStatus
    switch (inquiryStatus) {
      case 'approved':
      case 'completed':
        mappedStatus = KycStatus.APPROVED
        break
      case 'created':
      case 'needs_review':
      case 'pending':
        mappedStatus = KycStatus.PENDING
        break
      case 'declined':
      case 'expired':
      case 'failed':
        mappedStatus = KycStatus.REJECTED
    }

    // Construct a KYC link.
    const kycLink = `https://withpersona.com/verify?inquiry-id=${inquiryId}`

    return {
      inquiryId,
      kycLink,
      status: mappedStatus,
    }
  }

  public async startKyc({ userId }: { userId: string }): Promise<{ inquiryId: string, kycLink: string, status: KycStatus }> {
    const inquiryTemplateId: string = await this.secretManager.getSecret('PERSONA_INQUIRY_TEMPLATE_ID')
    const personaApiKey: string = await this.secretManager.getSecret('PERSONA_API_KEY')

    // Create a Persona inquiry
    const response = await axios.post(
      'https://api.withpersona.com/api/v1/inquiries',
      {
        data: {
          attributes: {
            'inquiry-template-id': inquiryTemplateId,
          },
        },
        meta: {
          'auto-create-account-reference-id': userId,
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
    ) as { data: PersonaKycResponse }

    const inquiryId = response.data.data.id
    const inquiryStatus = response.data.data.attributes.status

    // Convert Persona’s status (e.g. "created", "pending", etc.) to our KycStatus (assuming uppercase values)
    let mappedStatus: KycStatus
    switch (inquiryStatus) {
      case 'approved':
      case 'completed':
        mappedStatus = KycStatus.APPROVED
        break
      case 'created':
      case 'needs_review':
      case 'pending':
        mappedStatus = KycStatus.PENDING
        break
      case 'declined':
      case 'expired':
      case 'failed':
        mappedStatus = KycStatus.REJECTED
    }

    // Construct a KYC link.
    const kycLink = `https://withpersona.com/verify?inquiry-id=${inquiryId}`

    return {
      inquiryId,
      kycLink,
      status: mappedStatus,
    }
  }
}
