import { Container } from 'inversify'

import { FlowAuditService } from '../../modules/flows/application/FlowAuditService'
import { FlowCorridorService } from '../../modules/flows/application/FlowCorridorService'
import { FlowDefinitionBuilder } from '../../modules/flows/application/FlowDefinitionBuilder'
import { FlowDefinitionService } from '../../modules/flows/application/FlowDefinitionService'
import { FlowExecutorRegistry } from '../../modules/flows/application/FlowExecutorRegistry'
import { FlowOrchestrator } from '../../modules/flows/application/FlowOrchestrator'
import { FlowRetryWorker } from '../../modules/flows/application/FlowRetryWorker'
import { PublicCorridorService } from '../../modules/flows/application/PublicCorridorService'
import { RefundCoordinator } from '../../modules/flows/application/RefundCoordinator'
import { AwaitExchangeBalanceStepExecutor } from '../../modules/flows/application/steps/AwaitExchangeBalanceStepExecutor'
import { AwaitProviderStatusStepExecutor } from '../../modules/flows/application/steps/AwaitProviderStatusStepExecutor'
import { EnqueueBridgeStepExecutor } from '../../modules/flows/application/steps/EnqueueBridgeStepExecutor'
import { ExchangeConvertStepExecutor } from '../../modules/flows/application/steps/ExchangeConvertStepExecutor'
import { ExchangeSendStepExecutor } from '../../modules/flows/application/steps/ExchangeSendStepExecutor'
import { PayoutSendStepExecutor } from '../../modules/flows/application/steps/PayoutSendStepExecutor'
import { TreasuryTransferStepExecutor } from '../../modules/flows/application/steps/TreasuryTransferStepExecutor'
import { KycSubmissionService } from '../../modules/kyc/application/KycSubmissionService'
import { OpsKycService } from '../../modules/kyc/application/OpsKycService'
import { BusinessPerformanceCostReconciler } from '../../modules/operations/application/BusinessPerformanceCostReconciler'
import { BusinessPerformanceReconciliationService } from '../../modules/operations/application/BusinessPerformanceReconciliationService'
import { BusinessPerformanceReconciliationWorker } from '../../modules/operations/application/BusinessPerformanceReconciliationWorker'
import { OpsAdministrationService } from '../../modules/operations/application/OpsAdministrationService'
import { OpsAuditService } from '../../modules/operations/application/OpsAuditService'
import { OpsBusinessPerformanceService } from '../../modules/operations/application/OpsBusinessPerformanceService'
import { OpsCaseService } from '../../modules/operations/application/OpsCaseService'
import { OpsConfigurationReleaseService } from '../../modules/operations/application/OpsConfigurationReleaseService'
import { OpsConfigurationReleaseWorker } from '../../modules/operations/application/OpsConfigurationReleaseWorker'
import { OpsGlobalSearchService } from '../../modules/operations/application/OpsGlobalSearchService'
import { OpsIdentityService } from '../../modules/operations/application/OpsIdentityService'
import { OpsIncidentDetectionService } from '../../modules/operations/application/OpsIncidentDetectionService'
import { OpsIncidentService } from '../../modules/operations/application/OpsIncidentService'
import { OpsIncidentWorker } from '../../modules/operations/application/OpsIncidentWorker'
import { OpsIntegrationService } from '../../modules/operations/application/OpsIntegrationService'
import { OpsMutationService } from '../../modules/operations/application/opsMutation'
import { OpsOverviewService } from '../../modules/operations/application/OpsOverviewService'
import { OpsSavedViewService } from '../../modules/operations/application/OpsSavedViewService'
import { OpsTaskTelemetryService } from '../../modules/operations/application/OpsTaskTelemetryService'
import { OpsPartnerAnalyticsService } from '../../modules/partners/application/OpsPartnerAnalyticsService'
import { OpsPartnerService } from '../../modules/partners/application/OpsPartnerService'
import { PartnerAiAbuseProtectionService } from '../../modules/partners/application/PartnerAiAbuseProtectionService'
import { PartnerAiAuthorizationService } from '../../modules/partners/application/PartnerAiAuthorizationService'
import { PartnerAiConnectionService } from '../../modules/partners/application/PartnerAiConnectionService'
import { PartnerAiProductEventService } from '../../modules/partners/application/PartnerAiProductEventService'
import { PartnerAiTokenService } from '../../modules/partners/application/PartnerAiTokenService'
import { PartnerAiToolService } from '../../modules/partners/application/PartnerAiToolService'
import { PartnerAiWebhookDiagnosticsService } from '../../modules/partners/application/PartnerAiWebhookDiagnosticsService'
import { PartnerPortalAccountService } from '../../modules/partners/application/PartnerPortalAccountService'
import { PartnerPortalApiKeyService } from '../../modules/partners/application/PartnerPortalApiKeyService'
import { PartnerPortalAuditService } from '../../modules/partners/application/PartnerPortalAuditService'
import { PartnerPortalEmailDeliveryLifecycleService } from '../../modules/partners/application/PartnerPortalEmailDeliveryLifecycleService'
import { PartnerPortalIdentityService } from '../../modules/partners/application/PartnerPortalIdentityService'
import { PartnerPortalMfaService } from '../../modules/partners/application/PartnerPortalMfaService'
import { PartnerPortalPasswordService } from '../../modules/partners/application/PartnerPortalPasswordService'
import { PartnerPortalSecretEnvelopeService } from '../../modules/partners/application/PartnerPortalSecretEnvelopeService'
import { PartnerPortalSessionService } from '../../modules/partners/application/PartnerPortalSessionService'
import { PartnerPortalSignupProtectionService } from '../../modules/partners/application/PartnerPortalSignupProtectionService'
import { PartnerPortalSignupService } from '../../modules/partners/application/PartnerPortalSignupService'
import { PartnerPortalTeamService } from '../../modules/partners/application/PartnerPortalTeamService'
import { PartnerPortalVerificationEmailOutboxHandler } from '../../modules/partners/application/PartnerPortalVerificationEmailOutboxHandler'
import { PartnerPortalWebhookService } from '../../modules/partners/application/PartnerPortalWebhookService'
import { PartnerWebhookSecretResolver } from '../../modules/partners/application/PartnerWebhookSecretResolver'
import { ResendPartnerPortalEmailSender } from '../../modules/partners/application/ResendPartnerPortalEmailSender'
import { ResendWebhookVerifier } from '../../modules/partners/infrastructure/ResendWebhookVerifier'
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
import { QuoteRequestMetricRecorder } from '../../modules/quotes/application/QuoteRequestMetricRecorder'
import { QuoteUseCase } from '../../modules/quotes/application/quoteUseCase'
import { FlowCorridorPricingProvider } from '../../modules/quotes/infrastructure/FlowCorridorPricingProvider'
import { ConsumerActivityService } from '../../modules/transactions/application/ConsumerActivityService'
import { OpsRefundRecoveryService } from '../../modules/transactions/application/OpsRefundRecoveryService'
import { OpsTransactionQueryService } from '../../modules/transactions/application/OpsTransactionQueryService'
import { OpsTransactionReconciliationService } from '../../modules/transactions/application/OpsTransactionReconciliationService'
import { PartnerPixReceiptService } from '../../modules/transactions/application/PartnerPixReceiptService'
import { PartnerPixReconciliationService } from '../../modules/transactions/application/PartnerPixReconciliationService'
import { PartnerTransactionQueryService } from '../../modules/transactions/application/PartnerTransactionQueryService'
import { PartnerWebhookRedeliveryService } from '../../modules/transactions/application/PartnerWebhookRedeliveryService'
import { ReceivedCryptoTransactionUseCase } from '../../modules/transactions/application/receivedCryptoTransactionUseCase'
import { StellarOrphanRefundService } from '../../modules/transactions/application/StellarOrphanRefundService'
import { TransactionAcceptanceService } from '../../modules/transactions/application/TransactionAcceptanceService'
import { TransactionStatusService } from '../../modules/transactions/application/TransactionStatusService'
import { TransactionWebhookRouter } from '../../modules/transactions/application/TransactionWebhookRouter'
import { TransferoUltraClient } from '../../modules/transfero/infrastructure/TransferoUltraClient'
import { TransferoUltraWebhookConfigurationVerifier } from '../../modules/transfero/infrastructure/TransferoUltraWebhookConfigurationVerifier'
import { TransferoUltraWebhookVerifier } from '../../modules/transfero/infrastructure/TransferoUltraWebhookVerifier'
import { TransparencyMetricsService } from '../../modules/transparency/application/TransparencyMetricsService'
import { BridgeFloatService } from '../../modules/treasury/application/BridgeFloatService'
import { BridgeSweepService } from '../../modules/treasury/application/BridgeSweepService'
import { BridgeSweepWorker } from '../../modules/treasury/application/BridgeSweepWorker'
import { ExchangeProviderFactory } from '../../modules/treasury/application/ExchangeProviderFactory'
import { OpsBridgeService } from '../../modules/treasury/application/OpsBridgeService'
import { OpsTreasuryService } from '../../modules/treasury/application/OpsTreasuryService'
import { OpsTreasuryThresholdService } from '../../modules/treasury/application/OpsTreasuryThresholdService'
import { TreasurySnapshotWorker } from '../../modules/treasury/application/TreasurySnapshotWorker'
import { BinanceBalanceSource } from '../../modules/treasury/infrastructure/balanceSources/BinanceBalanceSource'
import { CeloBalanceSource } from '../../modules/treasury/infrastructure/balanceSources/CeloBalanceSource'
import { MoviiBalanceSource } from '../../modules/treasury/infrastructure/balanceSources/MoviiBalanceSource'
import { SolanaBalanceSource } from '../../modules/treasury/infrastructure/balanceSources/SolanaBalanceSource'
import { StellarBalanceSource } from '../../modules/treasury/infrastructure/balanceSources/StellarBalanceSource'
import { TransferoBalanceSource } from '../../modules/treasury/infrastructure/balanceSources/TransferoBalanceSource'
import { BinanceExchangeProvider } from '../../modules/treasury/infrastructure/exchangeProviders/binanceExchangeProvider'
import { BinanceBrlExchangeProvider } from '../../modules/treasury/infrastructure/exchangeProviders/binanceExchangeProvider'
import { TransferoExchangeProvider } from '../../modules/treasury/infrastructure/exchangeProviders/transferoExchangeProvider'
import { StellarListener } from '../../modules/treasury/interfaces/listeners/StellarListener'
import { BindingRegistration, registerBindings } from './bindingSupport'
import { TYPES } from './types'

const domainBindings: ReadonlyArray<BindingRegistration<unknown>> = [
  { identifier: TYPES.IPaymentServiceFactory, implementation: PaymentServiceFactory },
  { identifier: TYPES.IDepositVerifierRegistry, implementation: DepositVerifierRegistry },
  { bindSelf: true, identifier: PayoutStatusAdapterRegistry, implementation: PayoutStatusAdapterRegistry },
  { bindSelf: true, identifier: LiquidityCacheService, implementation: LiquidityCacheService },
  { bindSelf: true, identifier: TransferoUltraClient, implementation: TransferoUltraClient },
  { bindSelf: true, identifier: TransferoUltraWebhookConfigurationVerifier, implementation: TransferoUltraWebhookConfigurationVerifier },
  { bindSelf: true, identifier: TransferoUltraWebhookVerifier, implementation: TransferoUltraWebhookVerifier },
  { identifier: TYPES.IPayoutStatusAdapter, implementation: TransferoPayoutStatusAdapter },
  { identifier: TYPES.IPayoutStatusAdapter, implementation: BrebPayoutStatusAdapter },
  { identifier: TYPES.IExchangeProviderFactory, implementation: ExchangeProviderFactory },
  { identifier: TYPES.IWalletHandlerFactory, implementation: WalletHandlerFactory },
  { identifier: TYPES.IPixQrDecoder, implementation: PixQrDecoder },
  { identifier: TYPES.QuoteUseCase, implementation: QuoteUseCase },
  { bindSelf: true, identifier: QuoteRequestMetricRecorder, implementation: QuoteRequestMetricRecorder },
  { identifier: TYPES.ICorridorPricingProvider, implementation: FlowCorridorPricingProvider },
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
  { bindSelf: true, identifier: TransactionWebhookRouter, implementation: TransactionWebhookRouter },
  { identifier: TYPES.StellarOrphanRefundService, implementation: StellarOrphanRefundService },
  { bindSelf: true, identifier: OpsTransactionReconciliationService, implementation: OpsTransactionReconciliationService },
  { bindSelf: true, identifier: OpsTransactionQueryService, implementation: OpsTransactionQueryService },
  { bindSelf: true, identifier: OpsRefundRecoveryService, implementation: OpsRefundRecoveryService },
  { bindSelf: true, identifier: PartnerPixReceiptService, implementation: PartnerPixReceiptService },
  { bindSelf: true, identifier: PartnerPixReconciliationService, implementation: PartnerPixReconciliationService },
  { bindSelf: true, identifier: PartnerTransactionQueryService, implementation: PartnerTransactionQueryService },
  { bindSelf: true, identifier: ConsumerActivityService, implementation: ConsumerActivityService },
  { bindSelf: true, identifier: PartnerWebhookRedeliveryService, implementation: PartnerWebhookRedeliveryService },
  { bindSelf: true, identifier: TransparencyMetricsService, implementation: TransparencyMetricsService },
  { identifier: TYPES.PaymentUseCase, implementation: PaymentUseCase },
  { identifier: TYPES.ReceivedCryptoTransactionUseCase, implementation: ReceivedCryptoTransactionUseCase },
  { bindSelf: true, identifier: KycSubmissionService, implementation: KycSubmissionService },
  { bindSelf: true, identifier: OpsKycService, implementation: OpsKycService },
  { bindSelf: true, identifier: OpsAuditService, implementation: OpsAuditService },
  { bindSelf: true, identifier: OpsCaseService, implementation: OpsCaseService },
  { bindSelf: true, identifier: OpsConfigurationReleaseService, implementation: OpsConfigurationReleaseService },
  { bindSelf: true, identifier: OpsConfigurationReleaseWorker, implementation: OpsConfigurationReleaseWorker },
  { bindSelf: true, identifier: OpsGlobalSearchService, implementation: OpsGlobalSearchService },
  { bindSelf: true, identifier: OpsAdministrationService, implementation: OpsAdministrationService },
  { bindSelf: true, identifier: BusinessPerformanceCostReconciler, implementation: BusinessPerformanceCostReconciler },
  { bindSelf: true, identifier: BusinessPerformanceReconciliationService, implementation: BusinessPerformanceReconciliationService },
  { bindSelf: true, identifier: BusinessPerformanceReconciliationWorker, implementation: BusinessPerformanceReconciliationWorker },
  { bindSelf: true, identifier: OpsBusinessPerformanceService, implementation: OpsBusinessPerformanceService },
  { bindSelf: true, identifier: OpsIdentityService, implementation: OpsIdentityService },
  { bindSelf: true, identifier: OpsIncidentDetectionService, implementation: OpsIncidentDetectionService },
  { bindSelf: true, identifier: OpsIncidentService, implementation: OpsIncidentService },
  { bindSelf: true, identifier: OpsIncidentWorker, implementation: OpsIncidentWorker },
  { bindSelf: true, identifier: OpsIntegrationService, implementation: OpsIntegrationService },
  { bindSelf: true, identifier: OpsMutationService, implementation: OpsMutationService },
  { bindSelf: true, identifier: OpsOverviewService, implementation: OpsOverviewService },
  { bindSelf: true, identifier: OpsSavedViewService, implementation: OpsSavedViewService },
  { bindSelf: true, identifier: OpsTaskTelemetryService, implementation: OpsTaskTelemetryService },
  { bindSelf: true, identifier: OpsPartnerService, implementation: OpsPartnerService },
  { bindSelf: true, identifier: OpsPartnerAnalyticsService, implementation: OpsPartnerAnalyticsService },
  { bindSelf: true, identifier: PartnerAiAbuseProtectionService, implementation: PartnerAiAbuseProtectionService },
  { bindSelf: true, identifier: PartnerAiAuthorizationService, implementation: PartnerAiAuthorizationService },
  { bindSelf: true, identifier: PartnerAiConnectionService, implementation: PartnerAiConnectionService },
  { bindSelf: true, identifier: PartnerAiProductEventService, implementation: PartnerAiProductEventService },
  { bindSelf: true, identifier: PartnerAiTokenService, implementation: PartnerAiTokenService },
  { bindSelf: true, identifier: PartnerAiToolService, implementation: PartnerAiToolService },
  { bindSelf: true, identifier: PartnerAiWebhookDiagnosticsService, implementation: PartnerAiWebhookDiagnosticsService },
  { bindSelf: true, identifier: PartnerPortalPasswordService, implementation: PartnerPortalPasswordService },
  { bindSelf: true, identifier: PartnerPortalApiKeyService, implementation: PartnerPortalApiKeyService },
  { bindSelf: true, identifier: PartnerPortalMfaService, implementation: PartnerPortalMfaService },
  { bindSelf: true, identifier: PartnerPortalSecretEnvelopeService, implementation: PartnerPortalSecretEnvelopeService },
  { bindSelf: true, identifier: PartnerPortalAuditService, implementation: PartnerPortalAuditService },
  { bindSelf: true, identifier: PartnerPortalIdentityService, implementation: PartnerPortalIdentityService },
  { bindSelf: true, identifier: PartnerPortalEmailDeliveryLifecycleService, implementation: PartnerPortalEmailDeliveryLifecycleService },
  { bindSelf: true, identifier: PartnerPortalTeamService, implementation: PartnerPortalTeamService },
  { bindSelf: true, identifier: PartnerPortalWebhookService, implementation: PartnerPortalWebhookService },
  { bindSelf: true, identifier: PartnerWebhookSecretResolver, implementation: PartnerWebhookSecretResolver },
  { bindSelf: true, identifier: PartnerPortalSessionService, implementation: PartnerPortalSessionService },
  { bindSelf: true, identifier: PartnerPortalAccountService, implementation: PartnerPortalAccountService },
  { bindSelf: true, identifier: PartnerPortalSignupProtectionService, implementation: PartnerPortalSignupProtectionService },
  { identifier: TYPES.OutboxDeliveryHandler, implementation: PartnerPortalVerificationEmailOutboxHandler },
  { bindSelf: true, identifier: ResendPartnerPortalEmailSender, implementation: ResendPartnerPortalEmailSender },
  { bindSelf: true, identifier: ResendWebhookVerifier, implementation: ResendWebhookVerifier },
  { bindSelf: true, identifier: PartnerPortalSignupService, implementation: PartnerPortalSignupService },
  { bindSelf: true, identifier: FlowDefinitionBuilder, implementation: FlowDefinitionBuilder },
  { bindSelf: true, identifier: FlowDefinitionService, implementation: FlowDefinitionService },
  { bindSelf: true, identifier: FlowCorridorService, implementation: FlowCorridorService },
  { bindSelf: true, identifier: PublicCorridorService, implementation: PublicCorridorService },
  { bindSelf: true, identifier: FlowAuditService, implementation: FlowAuditService },
  { identifier: TYPES.FlowExecutorRegistry, implementation: FlowExecutorRegistry },
  { identifier: TYPES.FlowOrchestrator, implementation: FlowOrchestrator },
  { bindSelf: true, identifier: FlowRetryWorker, implementation: FlowRetryWorker },
  { bindSelf: true, identifier: RefundCoordinator, implementation: RefundCoordinator },
  { bindSelf: true, identifier: BridgeFloatService, implementation: BridgeFloatService },
  { bindSelf: true, identifier: BridgeSweepService, implementation: BridgeSweepService },
  { bindSelf: true, identifier: BridgeSweepWorker, implementation: BridgeSweepWorker },
  { bindSelf: true, identifier: OpsBridgeService, implementation: OpsBridgeService },
  { identifier: TYPES.ITreasuryBalanceSource, implementation: BinanceBalanceSource },
  { identifier: TYPES.ITreasuryBalanceSource, implementation: TransferoBalanceSource },
  { identifier: TYPES.ITreasuryBalanceSource, implementation: StellarBalanceSource },
  { identifier: TYPES.ITreasuryBalanceSource, implementation: CeloBalanceSource },
  { identifier: TYPES.ITreasuryBalanceSource, implementation: SolanaBalanceSource },
  { identifier: TYPES.ITreasuryBalanceSource, implementation: MoviiBalanceSource },
  { bindSelf: true, identifier: OpsTreasuryService, implementation: OpsTreasuryService },
  { bindSelf: true, identifier: OpsTreasuryThresholdService, implementation: OpsTreasuryThresholdService },
  { bindSelf: true, identifier: TreasurySnapshotWorker, implementation: TreasurySnapshotWorker },
  { identifier: TYPES.FlowStepExecutor, implementation: PayoutSendStepExecutor },
  { identifier: TYPES.FlowStepExecutor, implementation: AwaitProviderStatusStepExecutor },
  { identifier: TYPES.FlowStepExecutor, implementation: ExchangeSendStepExecutor },
  { identifier: TYPES.FlowStepExecutor, implementation: ExchangeConvertStepExecutor },
  { identifier: TYPES.FlowStepExecutor, implementation: AwaitExchangeBalanceStepExecutor },
  { identifier: TYPES.FlowStepExecutor, implementation: TreasuryTransferStepExecutor },
  { identifier: TYPES.FlowStepExecutor, implementation: EnqueueBridgeStepExecutor },
] as const

export function bindDomainServices(container: Container): void {
  registerBindings(container, domainBindings)
}
