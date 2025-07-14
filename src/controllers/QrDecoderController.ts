import { inject } from 'inversify'
import {
  Get,
  Query,
  Response,
  Route,
  Security,
} from 'tsoa'

import { IPixQrDecoder, PixDecoded } from '../interfaces/IQrDecoder'
import { TYPES } from '../types'

@Route('qr-decoder')
@Security('BearerAuth')
@Security('ApiKeyAuth')
export class QrDecoderController {
  constructor(
        @inject(TYPES.IPixQrDecoder) private pixQrDecoder: IPixQrDecoder,
  ) { }

  @Get('/br')
  @Response<200, { decoded: string }>(200, 'QR Code Decoded')
  @Response<400, { reason: string }>(400, 'Bad Request')
  public async decodeQrCodeBR(
    @Query() brCode: string,
  ): Promise<{ decoded: PixDecoded }> {
    if (!brCode || typeof brCode !== 'string') {
      throw new Error('Invalid BR Code provided')
    }
    try {
      const decoded = this.pixQrDecoder.decode(brCode)
      return { decoded }
    }
    catch (error) {
      if (error instanceof Error) {
        throw new Error(`Decoding failed: ${error.message}`)
      }
      throw new Error('An unknown error occurred during decoding')
    }
  }
}
