import { inject } from 'inversify'
import { randomUUID } from 'node:crypto'
import {
  Controller,
  Get,
  Query,
  Res,
  Response,
  Route,
  TsoaResponse,
} from 'tsoa'

import { TYPES } from '../../../../app/container/types'
import { IPixQrDecoder, PixDecoded } from '../../application/contracts/IQrDecoder'

/**
 * Ultra's quota is account-wide and refills in seconds, so a throttled preview
 * is worth retrying almost immediately — far sooner than the caller would guess
 * on its own.
 */
const RATE_LIMIT_RETRY_AFTER_SECONDS = 2

@Route('qr-decoder')
export class QrDecoderController extends Controller {
  constructor(
    @inject(TYPES.IPixQrDecoder) private pixQrDecoder: IPixQrDecoder,
  ) {
    super()
  }

  @Get('/br')
  @Response<200, { decoded: string }>(200, 'QR Code Decoded')
  @Response<429, { reason: string }>(429, 'Too Many Requests')
  @Response<502, { reason: string }>(502, 'Bad Gateway')
  public async decodeQrCodeBR(
    @Res() badRequestResponse: TsoaResponse<400, { reason: string }>,
    @Query() qrCode: string,
    @Res() tooManyRequests: TsoaResponse<429, { reason: string }>,
    @Res() badGateway: TsoaResponse<502, { reason: string }>,
  ): Promise<{ decoded: null | PixDecoded }> {
    if (!qrCode || typeof qrCode !== 'string') {
      return badRequestResponse(400, { reason: 'Invalid QR Code provided' })
    }
    try {
      const result = await this.pixQrDecoder.validateForPayment({
        idempotencyKey: `abroad:pix-preview:${randomUUID()}`,
        qrCode,
      })
      if (result.success) {
        return { decoded: result.decoded }
      }
      // A provider throttle and a broken provider are not the customer's QR
      // code being wrong. Collapsing all three into `decoded: null` told every
      // caller to check the code and try again, which is precisely the advice
      // that turned a brief rate limit into a self-sustaining retry storm.
      if (result.code === 'retriable') {
        this.setHeader('Retry-After', String(RATE_LIMIT_RETRY_AFTER_SECONDS))
        return tooManyRequests(429, {
          reason: 'The payment provider is busy. Retry in a moment.',
        })
      }
      if (result.code === 'permanent') {
        return badGateway(502, {
          reason: 'We could not reach the payment provider to check this QR code.',
        })
      }
      // Genuinely unusable QR (expired charge, wrong currency): unchanged.
      return { decoded: null }
    }
    catch (error) {
      if (error instanceof Error) {
        return badRequestResponse(400, { reason: error.message })
      }
      return badRequestResponse(400, { reason: 'An unknown error occurred during decoding' })
    }
  }
}
