import { Container } from 'inversify'

import { FlowAuditService } from '../../modules/flows/application/FlowAuditService'
import { FlowCorridorService } from '../../modules/flows/application/FlowCorridorService'
import { FlowDefinitionBuilder } from '../../modules/flows/application/FlowDefinitionBuilder'
import { FlowDefinitionService } from '../../modules/flows/application/FlowDefinitionService'
import { FlowExecutorRegistry } from '../../modules/flows/application/FlowExecutorRegistry'
import { FlowOrchestrator } from '../../modules/flows/application/FlowOrchestrator'
import { PublicCorridorService } from '../../modules/flows/application/PublicCorridorService'
import { RefundCoordinator } from '../../modules/flows/application/RefundCoordinator'
import { AwaitExchangeBalanceStepExecutor } from '../../modules/flows/application/steps/AwaitExchangeBalanceStepExecutor'
import { AwaitProviderStatusStepExecutor } from '../../modules/flows/application/steps/AwaitProviderStatusStepExecutor'
import { ExchangeConvertStepExecutor } from '../../modules/flows/application/steps/ExchangeConvertStepExecutor'
import { ExchangeSendStepExecutor } from '../../modules/flows/application/steps/ExchangeSendStepExecutor'
import { PayoutSendStepExecutor } from '../../modules/flows/application/steps/PayoutSendStepExecutor'
import { TreasuryTransferStepExecutor } from '../../modules/flows/application/steps/TreasuryTransferStepExecutor'
import { OpsPartnerService } from '../../modules/partners/application/OpsPartnerService'
import { CryptoAssetConfigService } from '../../modules/payments/application/CryptoAssetConfigService'
import { DepositVerifierRegistry } from '../../modules/payments/application/DepositVerifierRegistry'
import { LiquidityCacheService } from '../../modules/payments/application/LiquidityCacheService'
import { PaymentContextService } from '../../modules/payments/application/PaymentContextService'
import { PaymentServiceFactory } from '../../modules/payments/application/PaymentServiceFactory'
import { PaymentUseCase } from '../../modules/payments/application/paymentUseCase'
import { PayoutStatusAdapterRegistry } from '../../modules/payments/application/PayoutStatusAdapterRegistry'
import { WalletHandlerFactory } from '../../modules/payments/application/WalletHandlerFactory'
import { BrebPayoutStatusAdapter } from '../../modules/payments/infrastructure/BrebPayoutStatusAdapter'
import { BrebPaymentService } from '../../modules/payments/infrastructure/paymentProviders/brebPaymentService'
import { PixQrDecoder } from '../../modules/payments/infrastructure/paymentProviders/PixQrDecoder'
import { TransferoPaymentService } from '../../modules/payments/infrastructure/paymentProviders/transferoPaymentService'
import { TransferoPayoutStatusAdapter } from '../../modules/payments/infrastructure/TransferoPayoutStatusAdapter'
import { CeloPaymentVerifier } from '../../modules/payments/infrastructure/wallets/CeloPaymentVerifier'
import { CeloWalletHandler } from '../../modules/payments/infrastructure/wallets/CeloWalletHandler'
import { SolanaPaymentVerifier } from '../../modules/payments/infrastructure/wallets/SolanaPaymentVerifier'
import { SolanaWalletHandler } from '../../modules/payments/infrastructure/wallets/SolanaWalletHandler'
import { StellarDepositVerifier } from '../../modules/payments/infrastructure/wallets/StellarDepositVerifier'
import { StellarWalletHandler } from '../../modules/payments/infrastructure/wallets/StellarWalletHandler'
import { QuoteUseCase } from '../../modules/quotes/application/quoteUseCase'
import { OpsTransactionReconciliationService } from '../../modules/transactions/application/OpsTransactionReconciliationService'
import { ReceivedCryptoTransactionUseCase } from '../../modules/transactions/application/receivedCryptoTransactionUseCase'
import { StellarOrphanRefundService } from '../../modules/transactions/application/StellarOrphanRefundService'
import { TransactionAcceptanceService } from '../../modules/transactions/application/TransactionAcceptanceService'
import { TransactionStatusService } from '../../modules/transactions/application/TransactionStatusService'
import { ExchangeProviderFactory } from '../../modules/treasury/application/ExchangeProviderFactory'
import { BinanceExchangeProvider } from '../../modules/treasury/infrastructure/exchangeProviders/binanceExchangeProvider'
import { BinanceBrlExchangeProvider } from '../../modules/treasury/infrastructure/exchangeProviders/binanceExchangeProvider'
import { TransferoExchangeProvider } from '../../modules/treasury/infrastructure/exchangeProviders/transferoExchangeProvider'
import { StellarListener } from '../../modules/treasury/interfaces/listeners/StellarListener'
import { PersonaWebhookService } from '../../modules/webhooks/application/PersonaWebhookService'
import { BindingRegistration, registerBindings } from './bindingSupport'
import { TYPES } from './types'

const domainBindings: ReadonlyArray<BindingRegistration<unknown>> = [
  { identifier: TYPES.IPaymentServiceFactory, implementation: PaymentServiceFactory },
  { identifier: TYPES.IDepositVerifierRegistry, implementation: DepositVerifierRegistry },
  { bindSelf: true, identifier: PayoutStatusAdapterRegistry, implementation: PayoutStatusAdapterRegistry },
  { bindSelf: true, identifier: LiquidityCacheService, implementation: LiquidityCacheService },
  { identifier: TYPES.IPayoutStatusAdapter, implementation: TransferoPayoutStatusAdapter },
  { identifier: TYPES.IPayoutStatusAdapter, implementation: BrebPayoutStatusAdapter },
  { identifier: TYPES.IExchangeProviderFactory, implementation: ExchangeProviderFactory },
  { identifier: TYPES.IWalletHandlerFactory, implementation: WalletHandlerFactory },
  { identifier: TYPES.IPixQrDecoder, implementation: PixQrDecoder },
  { identifier: TYPES.QuoteUseCase, implementation: QuoteUseCase },
  { identifier: TYPES.CeloWalletHandler, implementation: CeloWalletHandler },
  { identifier: TYPES.SolanaPaymentVerifier, implementation: SolanaPaymentVerifier },
  { identifier: TYPES.SolanaWalletHandler, implementation: SolanaWalletHandler },
  { identifier: TYPES.StellarListener, implementation: StellarListener },
  { identifier: TYPES.StellarWalletHandler, implementation: StellarWalletHandler },
  { identifier: TYPES.IPaymentService, implementation: BrebPaymentService, name: 'breb' },
  { identifier: TYPES.IPaymentService, implementation: TransferoPaymentService, name: 'transfero' },
  { identifier: TYPES.CeloPaymentVerifier, implementation: CeloPaymentVerifier },
  { identifier: TYPES.IDepositVerifier, implementation: SolanaPaymentVerifier },
  { identifier: TYPES.IDepositVerifier, implementation: CeloPaymentVerifier },
  { identifier: TYPES.IDepositVerifier, implementation: StellarDepositVerifier },
  { bindSelf: true, identifier: CryptoAssetConfigService, implementation: CryptoAssetConfigService },
  { bindSelf: true, identifier: PaymentContextService, implementation: PaymentContextService },
  { identifier: TYPES.IExchangeProvider, implementation: BinanceExchangeProvider, name: 'binance' },
  { identifier: TYPES.IExchangeProvider, implementation: BinanceBrlExchangeProvider, name: 'binance-brl' },
  { identifier: TYPES.IExchangeProvider, implementation: TransferoExchangeProvider, name: 'transfero' },
  { identifier: TYPES.TransactionAcceptanceService, implementation: TransactionAcceptanceService },
  { identifier: TYPES.TransactionStatusService, implementation: TransactionStatusService },
  { identifier: TYPES.StellarOrphanRefundService, implementation: StellarOrphanRefundService },
  { bindSelf: true, identifier: OpsTransactionReconciliationService, implementation: OpsTransactionReconciliationService },
  { identifier: TYPES.PaymentUseCase, implementation: PaymentUseCase },
  { identifier: TYPES.ReceivedCryptoTransactionUseCase, implementation: ReceivedCryptoTransactionUseCase },
  { bindSelf: true, identifier: PersonaWebhookService, implementation: PersonaWebhookService },
  { bindSelf: true, identifier: OpsPartnerService, implementation: OpsPartnerService },
  { bindSelf: true, identifier: FlowDefinitionBuilder, implementation: FlowDefinitionBuilder },
  { bindSelf: true, identifier: FlowDefinitionService, implementation: FlowDefinitionService },
  { bindSelf: true, identifier: FlowCorridorService, implementation: FlowCorridorService },
  { bindSelf: true, identifier: PublicCorridorService, implementation: PublicCorridorService },
  { bindSelf: true, identifier: FlowAuditService, implementation: FlowAuditService },
  { identifier: TYPES.FlowExecutorRegistry, implementation: FlowExecutorRegistry },
  { identifier: TYPES.FlowOrchestrator, implementation: FlowOrchestrator },
  { bindSelf: true, identifier: RefundCoordinator, implementation: RefundCoordinator },
  { identifier: TYPES.FlowStepExecutor, implementation: PayoutSendStepExecutor },
  { identifier: TYPES.FlowStepExecutor, implementation: AwaitProviderStatusStepExecutor },
  { identifier: TYPES.FlowStepExecutor, implementation: ExchangeSendStepExecutor },
  { identifier: TYPES.FlowStepExecutor, implementation: ExchangeConvertStepExecutor },
  { identifier: TYPES.FlowStepExecutor, implementation: AwaitExchangeBalanceStepExecutor },
  { identifier: TYPES.FlowStepExecutor, implementation: TreasuryTransferStepExecutor },
] as const

export function bindDomainServices(container: Container): void {
  registerBindings(container, domainBindings)
}
