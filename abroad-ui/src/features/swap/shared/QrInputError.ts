export type QrInputErrorCode
  = | 'below-minimum'
    | 'invalid-payload'
    | 'provider-unavailable'
    | 'quote-unavailable'
    | 'rate-limited'
    | 'unsupported-currency'
    | 'wallet-connection'
    | 'wrong-rail'

export class QrInputError extends Error {
  public readonly code: QrInputErrorCode

  public constructor(code: QrInputErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'QrInputError'
  }
}
