import {
  BlockchainNetwork,
  CryptoCurrency,
  FlowCorridorStatus,
  FlowPricingProvider,
  PaymentMethod,
  TargetCurrency,
} from '@prisma/client'

import { FlowCorridorService } from '../../../../modules/flows/application/FlowCorridorService'
import { FlowDefinitionService } from '../../../../modules/flows/application/FlowDefinitionService'
import { FlowCorridorController } from '../../../../modules/flows/interfaces/http/FlowCorridorController'
import { FlowDefinitionController } from '../../../../modules/flows/interfaces/http/FlowDefinitionController'
import { OpsConfigurationReleaseRequiredError } from '../../../../modules/operations/application/OpsConfigurationGovernance'
import { CryptoAssetConfigService } from '../../../../modules/payments/application/CryptoAssetConfigService'
import { CryptoAssetController } from '../../../../modules/payments/interfaces/http/CryptoAssetController'

const definitionInput = {
  blockchain: BlockchainNetwork.STELLAR,
  cryptoCurrency: CryptoCurrency.USDC,
  enabled: true,
  name: 'USDC to BRL',
  payoutProvider: PaymentMethod.PIX,
  pricingProvider: FlowPricingProvider.TRANSFERO,
  steps: [{ type: 'PAYOUT' as const }],
  targetCurrency: TargetCurrency.BRL,
}

const definitionController = new FlowDefinitionController({} as FlowDefinitionService)
const corridorController = new FlowCorridorController({} as FlowCorridorService)
const assetController = new CryptoAssetController({} as CryptoAssetConfigService)

describe('Ops configuration governance boundary', () => {
  it.each([
    ['definition creation', () => definitionController.create(definitionInput)],
    ['definition update', () => definitionController.update('definition-1', definitionInput)],
    ['corridor update', () => corridorController.update({
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      status: FlowCorridorStatus.UNSUPPORTED,
      targetCurrency: TargetCurrency.BRL,
    })],
    ['asset update', () => assetController.update({
      blockchain: BlockchainNetwork.STELLAR,
      cryptoCurrency: CryptoCurrency.USDC,
      decimals: 7,
      enabled: true,
      mintAddress: 'GA-ISSUER',
    })],
  ] satisfies ReadonlyArray<readonly [string, () => Promise<unknown>]>)('%s requires a reviewed release', async (_name, operation) => {
    await expect(operation()).rejects.toMatchObject({
      code: 'ops_configuration_release_required',
      statusCode: 409,
    })
    await expect(operation()).rejects.toBeInstanceOf(OpsConfigurationReleaseRequiredError)
  })
})
