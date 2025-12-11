// src/types.ts
const typeKeys = [
  'BinanceBalanceUpdatedController',
  'IDatabaseClientProvider',
  'IExchangeProvider',
  'IExchangeProviderFactory',
  'IKycService',
  'ILockManager',
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
  'PaymentSentController',
  'PaymentStatusUpdatedController',
  'QuoteUseCase',
  'ReceivedCryptoTransactionController',
  'SolanaWalletHandler',
  'StellarWalletHandler',
  'TransactionAcceptanceService',
  'TransactionStatusService',
] as const

type TypeKey = typeof typeKeys[number]

export const TYPES: Record<TypeKey, symbol> = Object.freeze(
  Object.fromEntries(typeKeys.map(key => [key, Symbol.for(key)])) as Record<TypeKey, symbol>,
)
