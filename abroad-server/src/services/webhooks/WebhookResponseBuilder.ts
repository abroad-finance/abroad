import { WebhookProcessingResult } from './types'

export function buildWebhookResult(status: WebhookProcessingResult['status'], message: string): WebhookProcessingResult {
  if (status === 'ok') {
    return { payload: { message, success: true }, status }
  }

  return { payload: { message, success: false }, status }
}
