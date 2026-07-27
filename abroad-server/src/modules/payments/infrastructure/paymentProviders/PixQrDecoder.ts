import { inject, injectable } from 'inversify'
import { randomUUID } from 'node:crypto'
import { ZodError } from 'zod'

import { TYPES } from '../../../../app/container/types'
import { createScopedLogger, ScopedLogger } from '../../../../core/logging/scopedLogger'
import { ILogger } from '../../../../core/logging/types'
import { TransferoUltraClient, TransferoUltraError } from '../../../transfero/infrastructure/TransferoUltraClient'
import { transferoUltraQrPreviewResponseSchema } from '../../../transfero/infrastructure/transferoUltraSchemas'
import { IPixQrDecoder, PixDecoded, PixQrValidationResult } from '../../application/contracts/IQrDecoder'

const PAYABLE_QR_STATUS = 'CREATED'

@injectable()
export class PixQrDecoder implements IPixQrDecoder {
  private readonly logger: ScopedLogger

  public constructor(
    @inject(TransferoUltraClient) private readonly ultraClient: TransferoUltraClient,
    @inject(TYPES.ILogger) baseLogger: ILogger,
  ) {
    this.logger = createScopedLogger(baseLogger, { scope: 'TransferoUltraPixQrDecoder' })
  }

  public decode = async (qrCode: string): Promise<null | PixDecoded> => {
    const result = await this.validateForPayment({
      idempotencyKey: `abroad:pix-preview:${randomUUID()}`,
      qrCode,
    })
    if (!result.success) {
      this.logger.warn('Transfero Ultra PIX QR preview rejected', {
        code: result.code,
      })
      return null
    }
    return result.decoded
  }

  public async validateForPayment(params: {
    idempotencyKey: string
    qrCode: string
  }): Promise<PixQrValidationResult> {
    try {
      const response = await this.ultraClient.post(
        '/api/v1/pix/brcode-previews',
        { brcode: params.qrCode },
        params.idempotencyKey,
      )
      const preview = transferoUltraQrPreviewResponseSchema.parse(response)
      const status = preview.status.trim().toUpperCase()
      if (status !== PAYABLE_QR_STATUS) {
        return {
          code: 'validation',
          reason: `pix_qr_not_payable:${status}`,
          success: false,
        }
      }

      const currency = preview.currency.trim().toUpperCase()
      if (currency !== '986' && currency !== 'BRL') {
        return {
          code: 'validation',
          reason: `pix_qr_currency_not_supported:${currency}`,
          success: false,
        }
      }

      return {
        decoded: {
          account: preview.pixKey,
          amount: preview.amount === null || preview.amount === undefined
            ? undefined
            : preview.amount.toFixed(2),
          currency: 'BRL',
          name: preview.merchantName ?? undefined,
          status,
          txid: preview.txid ?? undefined,
          type: preview.type,
        },
        success: true,
      }
    }
    catch (error) {
      if (error instanceof TransferoUltraError) {
        return { code: error.code, reason: error.message, success: false }
      }
      if (error instanceof ZodError) {
        this.logger.error('Transfero Ultra PIX QR preview schema mismatch', {
          issues: error.issues,
        })
        return {
          code: 'permanent',
          reason: 'transfero_ultra_qr_preview_schema_mismatch',
          success: false,
        }
      }

      const reason = error instanceof Error
        ? error.message
        : 'transfero_ultra_qr_preview_unknown_error'
      return { code: 'retriable', reason, success: false }
    }
  }
}
