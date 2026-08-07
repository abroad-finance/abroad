import { inject, injectable } from 'inversify'

import { TransferoUltraClient, TransferoUltraError } from '../../transfero/infrastructure/TransferoUltraClient'
import { transferoUltraWithdrawalDetailResponseSchema } from '../../transfero/infrastructure/transferoUltraSchemas'
import { IPartnerPixProvider, PixReceiptResult, PixWithdrawalReadResult } from '../application/contracts/IPartnerPixProvider'

/**
 * Transfero Ultra behind the partner PIX read port.
 *
 * The status-code mapping lives here so the application layer never sees an
 * HTTP status: 404/409 on a receipt means the provider has nothing to hand over
 * yet, and a 404 on a withdrawal read is the signal the reconciler weighs
 * against its settling window.
 */
@injectable()
export class TransferoPartnerPixProvider implements IPartnerPixProvider {
  public constructor(
    @inject(TransferoUltraClient)
    private readonly ultraClient: TransferoUltraClient,
  ) {}

  public async fetchWithdrawalReceipt(params: {
    language: string
    withdrawalId: string
  }): Promise<PixReceiptResult> {
    try {
      const receipt = await this.ultraClient.getPdf(
        `/api/v1/pix/withdrawals/${encodeURIComponent(params.withdrawalId)}/receipt`,
        { lang: params.language },
      )
      return { contentType: receipt.contentType, data: receipt.data, success: true }
    }
    catch (error) {
      if (
        error instanceof TransferoUltraError
        && (error.status === 404 || error.status === 409)
      ) {
        return { reason: 'unavailable', success: false }
      }
      return { reason: 'provider_error', success: false }
    }
  }

  public async readWithdrawalDetail(withdrawalId: string): Promise<PixWithdrawalReadResult> {
    let raw: unknown
    try {
      raw = await this.ultraClient.get(`/api/v1/pix/withdrawals/${withdrawalId}`)
    }
    catch (error) {
      if (error instanceof TransferoUltraError && error.status === 404) {
        return { reason: 'not_found', success: false }
      }
      return { reason: 'provider_unavailable', success: false }
    }

    const parsed = transferoUltraWithdrawalDetailResponseSchema.safeParse(raw)
    // A payload describing a different withdrawal is as untrustworthy as one
    // that fails the schema, so both collapse to the same outcome.
    if (!parsed.success || parsed.data.id !== withdrawalId) {
      return { reason: 'invalid_response', success: false }
    }

    return {
      detail: {
        endToEndId: parsed.data.endToEndId,
        id: parsed.data.id,
        status: parsed.data.status,
      },
      success: true,
    }
  }
}
