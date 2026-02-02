import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  Patch,
  Res,
  Response,
  Route,
  Security,
  SuccessResponse,
  TsoaResponse,
} from 'tsoa'

import { CryptoAssetConfigError, CryptoAssetConfigService } from '../../application/CryptoAssetConfigService'
import { CryptoAssetCoverageDto, CryptoAssetCoverageResponse, CryptoAssetUpdateInput, cryptoAssetUpdateSchema } from '../../application/cryptoAssetSchemas'

@Route('ops/crypto-assets')
@Security('OpsApiKeyAuth')
export class CryptoAssetController extends Controller {
  constructor(
    @inject(CryptoAssetConfigService) private readonly cryptoAssetService: CryptoAssetConfigService,
  ) {
    super()
  }

  @Get()
  @SuccessResponse('200', 'Crypto asset coverage retrieved')
  public async list(): Promise<CryptoAssetCoverageResponse> {
    return this.cryptoAssetService.listCoverage()
  }

  @Patch()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @SuccessResponse('200', 'Crypto asset updated')
  public async update(
    @Body() body: CryptoAssetUpdateInput,
    @Res() badRequest: TsoaResponse<400, { reason: string }>,
  ): Promise<CryptoAssetCoverageDto> {
    const parsed = cryptoAssetUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return badRequest(400, { reason: parsed.error.message })
    }

    try {
      return await this.cryptoAssetService.upsert(parsed.data)
    }
    catch (error) {
      if (error instanceof CryptoAssetConfigError) {
        return badRequest(400, { reason: error.message })
      }
      throw error
    }
  }
}
