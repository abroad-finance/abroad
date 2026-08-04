export type QuoteRequestErrorCode
  = | 'corridor_unavailable'
    | 'maximum'
    | 'minimum'
    | 'quote_unavailable'

export class QuoteRequestError extends Error {
  public constructor(
    public readonly code: QuoteRequestErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly status: 400 | 500,
  ) {
    super(message)
    this.name = 'QuoteRequestError'
  }
}
