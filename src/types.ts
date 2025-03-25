// src/types.ts
export const TYPES = {
  IDatabaseClientProvider: Symbol.for('IDatabaseClientProvider'),
  IExchangeRateProvider: Symbol.for('IExchangeRateProvider'),
  IKycService: Symbol.for('IKycService'),
  ILogger: Symbol.for('ILogger'),
  IPartnerService: Symbol.for('IPartnerService'),
  IPaymentService: Symbol.for('IPaymentService'),
  IPaymentServiceFactory: Symbol.for('IPaymentServiceFactory'),
  IQueueHandler: Symbol.for('IQueueHandler'),
  ISecretManager: Symbol.for('ISecretManager'),
  ISlackNotifier: Symbol.for('ISlackNotifier'),
  KycUseCase: Symbol.for('KycUseCase'),
  QuoteUseCase: Symbol.for('QuoteUseCase'),
  StellarTransactionsController: Symbol.for('StellarTransactionsController'),
}
