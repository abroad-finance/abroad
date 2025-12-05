export type WebhookProcessingResult
  = | {
    payload: { message: string, success: false }
    status: 'bad_request' | 'error' | 'not_found'
  }
  | {
    payload: { message: string, success: true }
    status: 'ok'
  }
