// src/types.ts
export const TYPES = {
  IDatabaseClientProvider: Symbol.for('IDatabaseClientProvider'),
  IExchangeProvider: Symbol.for('IExchangeProvider'),
  IKycService: Symbol.for('IKycService'),
  ILogger: Symbol.for('ILogger'),
  IPartnerService: Symbol.for('IPartnerService'),
  IPaymentService: Symbol.for('IPaymentService'),
  IPaymentServiceFactory: Symbol.for('IPaymentServiceFactory'),
  IQueueHandler: Symbol.for('IQueueHandler'),
  ISecretManager: Symbol.for('ISecretManager'),
  ISlackNotifier: Symbol.for('ISlackNotifier'),
  IWalletHandlerFactory: Symbol.for('IWalletHandlerFactory'),
  KycUseCase: Symbol.for('KycUseCase'),
  PaymentSentController: Symbol.for('PaymentSentController'),
  QuoteUseCase: Symbol.for('QuoteUseCase'),
  TransactionsController: Symbol.for('TransactionsController'),
}
