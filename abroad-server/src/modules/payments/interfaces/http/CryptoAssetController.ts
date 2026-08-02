import { inject } from 'inversify'
import {
  Body,
  Controller,
  Get,
  OperationId,
  Patch,
  Response,
  Route,
  Security,
  SuccessResponse,
} from 'tsoa'

import { OpsConfigurationReleaseRequiredError } from '../../../operations/application/OpsConfigurationGovernance'
import { CryptoAssetConfigService } from '../../application/CryptoAssetConfigService'
import { CryptoAssetCoverageDto, CryptoAssetCoverageResponse, CryptoAssetUpdateInput } from '../../application/cryptoAssetSchemas'

@Route('ops/crypto-assets')
export class CryptoAssetController extends Controller {
  constructor(
    @inject(CryptoAssetConfigService) private readonly cryptoAssetService: CryptoAssetConfigService,
  ) {
    super()
  }

  @Get()
  @Security('OpsAuth', ['configuration:read'])
  @SuccessResponse('200', 'Crypto asset coverage retrieved')
  public async list(): Promise<CryptoAssetCoverageResponse> {
    return this.cryptoAssetService.listCoverage()
  }

  @OperationId('CryptoAssetUpdate')
  @Patch()
  @Response<400, { reason: string }>(400, 'Bad Request')
  @Response<409, { reason: string }>(409, 'Configuration release required')
  @Security('OpsAuth', ['configuration:manage'])
  public async update(
    @Body() _body: CryptoAssetUpdateInput,
  ): Promise<CryptoAssetCoverageDto> {
    void _body
    throw new OpsConfigurationReleaseRequiredError()
  }
}
