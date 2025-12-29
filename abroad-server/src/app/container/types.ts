// src/types.ts
const typeKeys = [
  'AppConfig',
  'BinanceBalanceUpdatedController',
  'IDatabaseClientProvider',
  'IExchangeProvider',
  'IExchangeProviderFactory',
  'IKycService',
  'ILockManager',
  'IOutboxDispatcher',
  'ILogger',
  'IPartnerService',
  'IPaymentService',
  'IPaymentServiceFactory',
  'IPixQrDecoder',
  'IQueueHandler',
  'ISecretManager',
  'ISlackNotifier',
  'IWalletHandlerFactory',
  'IWebhookNotifier',
  'IWebSocketService',
  'KycUseCase',
  'PaymentSentUseCase',
  'PaymentSentController',
  'PaymentStatusUpdatedController',
  'PaymentUseCase',
  'QuoteUseCase',
  'ReceivedCryptoTransactionController',
  'ReceivedCryptoTransactionUseCase',
  'SolanaPaymentVerifier',
  'SolanaWalletHandler',
  'StellarWalletHandler',
  'TransactionAcceptanceService',
  'TransactionStatusService',
  'TransactionWorkflow',
] as const

type TypeKey = typeof typeKeys[number]

export const TYPES: Record<TypeKey, symbol> = Object.freeze(
  Object.fromEntries(typeKeys.map(key => [key, Symbol.for(key)])) as Record<TypeKey, symbol>,
)
