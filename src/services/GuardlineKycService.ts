import { KycStatus, KYCTier } from '@prisma/client'
import axios from 'axios'
import { inject } from 'inversify'

import { nextWorkflowId } from '../constants/workflowRules'
import { IDatabaseClientProvider } from '../interfaces/IDatabaseClientProvider'
import { IKycService } from '../interfaces/IKycService'
import { ISecretManager } from '../interfaces/ISecretManager'
import { TYPES } from '../types'

type GuardlineKycStatus =
  | 'CANCELED'
  | 'COMPLETED_FAILURE'
  | 'COMPLETED_SUCCESS'
  | 'INCOMPLETE'

export class GuardLineKycService implements IKycService {
  constructor(
    @inject(TYPES.IDatabaseClientProvider) private dbProvider: IDatabaseClientProvider,
    @inject(TYPES.ISecretManager) private secretManager: ISecretManager,
  ) {

  }

  public getKycLink: IKycService['getKycLink'] = async ({
    amount,
    country,
    redirectUrl,
    userId,
  }) => {
    const client = await this.dbProvider.getClient()
    const highestKyc = await client.partnerUserKyc.findFirst({ orderBy: { createdAt: 'desc' }, where: { partnerUserId: userId } })
    let existingTier: KYCTier
    if (!highestKyc) {
      existingTier = KYCTier.NONE
    }
    else {
      existingTier = highestKyc.tier
    }

    if (highestKyc && highestKyc.status !== KycStatus.APPROVED) {
      return highestKyc.link
    }

    const workflowDefinitionId = nextWorkflowId(country, amount, existingTier)

    if (!workflowDefinitionId) {
      return null
    }

    const tenantId = await this.secretManager.getSecret('GUARDLINE_TENANT_ID')

    const { data } = await axios.post<{
      first_step_name: string
      workflow_instance_id: string
    }>(`https://onboarding.guardline.io/api/workflow-executor/${tenantId}/WorkflowInstance`, {
      workflow_definition_id: workflowDefinitionId,
    })

    const kycLink = this.buildKycLink(
      data.workflow_instance_id,
      data.first_step_name,
      tenantId,
      redirectUrl,
    )

    await client.partnerUserKyc.create({
      data: {
        externalId: data.workflow_instance_id,
        link: kycLink,
        partnerUserId: userId,
        status: KycStatus.PENDING,
        tier: existingTier,
      },
    })

    return kycLink
  }

  /* ---------------------------------------------------------------------
   * Helpers
   * ------------------------------------------------------------------- */

  private buildKycLink(
    instanceId: string,
    firstStep: string,
    tenantId: string,
    redirectUrl?: string,
  ): string {
    const base = `https://onboarding.guardline.io/${tenantId}/${instanceId}/${firstStep}`
    return redirectUrl
      ? `${base}?redirect_uri=${redirectUrl}`
      : base
  }

  private mapStatus(raw: GuardlineKycStatus): KycStatus {
    switch (raw) {
      case 'CANCELED':
        return KycStatus.REJECTED
      case 'COMPLETED_FAILURE':
        return KycStatus.REJECTED
      case 'COMPLETED_SUCCESS':
        return KycStatus.APPROVED
      case 'INCOMPLETE':
        return KycStatus.PENDING_APPROVAL
      default:
        return KycStatus.PENDING_APPROVAL
    }
  }
}
