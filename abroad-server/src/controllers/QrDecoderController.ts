import { inject } from 'inversify'
import {
  Get,
  Query,
  Res,
  Response,
  Route,
  TsoaResponse,
} from 'tsoa'

import { IPixQrDecoder, PixDecoded } from '../interfaces/IQrDecoder'
import { TYPES } from '../types'

@Route('qr-decoder')
export class QrDecoderController {
  constructor(
    @inject(TYPES.IPixQrDecoder) private pixQrDecoder: IPixQrDecoder,
  ) { }

  @Get('/br')
  @Response<200, { decoded: string }>(200, 'QR Code Decoded')
  public async decodeQrCodeBR(
    @Res() badRequestResponse: TsoaResponse<400, { reason: string }>,
    @Query() qrCode: string,
  ): Promise<{ decoded: null | PixDecoded }> {
    if (!qrCode || typeof qrCode !== 'string') {
      return badRequestResponse(400, { reason: 'Invalid QR Code provided' })
    }
    try {
      const decoded = await this.pixQrDecoder.decode(qrCode)
      return { decoded }
    }
    catch (error) {
      if (error instanceof Error) {
        return badRequestResponse(400, { reason: error.message })
      }
      return badRequestResponse(400, { reason: 'An unknown error occurred during decoding' })
    }
  }
}
