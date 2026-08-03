import axios from 'axios'
import { inject, injectable } from 'inversify'
import { z } from 'zod'

import { TYPES } from '../../../app/container/types'
import { ISecretManager } from '../../../platform/secrets/ISecretManager'

const RESEND_EMAIL_ENDPOINT = 'https://api.resend.com/emails'
const REQUEST_TIMEOUT_MS = 7_000
const RETRY_DELAY_MS = 250
const MAX_DELIVERY_ATTEMPTS = 2

const resendResponseSchema = z.object({
  id: z.string().trim().min(1).max(256),
}).passthrough()

type PartnerPortalEmailDeliveryFailureCode
  = | 'CONFIGURATION_INVALID'
    | 'PROVIDER_REJECTED'
    | 'PROVIDER_RESPONSE_INVALID'
    | 'PROVIDER_UNAVAILABLE'

type PartnerPortalVerificationEmailInput = {
  email: string
  firstName: string
  plaintextToken: string
  tokenId: string
}

type PartnerPortalVerificationEmailResult = {
  providerMessageId: string
}

export class PartnerPortalEmailDeliveryError extends Error {
  public readonly retryable: boolean

  public constructor(public readonly code: PartnerPortalEmailDeliveryFailureCode) {
    super('Verification email could not be delivered')
    this.name = 'PartnerPortalEmailDeliveryError'
    this.retryable = code === 'PROVIDER_UNAVAILABLE'
  }
}

@injectable()
export class ResendPartnerPortalEmailSender {
  public constructor(
    @inject(TYPES.ISecretManager)
    private readonly secretManager: ISecretManager,
  ) {}

  public async sendVerificationEmail(
    input: PartnerPortalVerificationEmailInput,
  ): Promise<PartnerPortalVerificationEmailResult> {
    const configuration = await this.readConfiguration()
    const verificationUrl = this.buildVerificationUrl(
      configuration.publicUrl,
      input.plaintextToken,
    )
    const greetingName = this.escapeHtml(input.firstName)
    const escapedVerificationUrl = this.escapeHtml(verificationUrl)
    const request = {
      from: configuration.from,
      html: [
        '<!doctype html><html lang="en"><body style="font-family:Arial,sans-serif;color:#12332f;line-height:1.6">',
        `<p>Hello ${greetingName},</p>`,
        '<p>Verify your email address to activate your Abroad partner workspace.</p>',
        `<p><a href="${escapedVerificationUrl}">Verify email address</a></p>`,
        '<p>This link expires in 24 hours and can be used only once.</p>',
        '<p>If you did not request this account, you can ignore this email.</p>',
        '</body></html>',
      ].join(''),
      subject: 'Verify your Abroad partner account',
      text: [
        `Hello ${input.firstName},`,
        '',
        'Verify your email address to activate your Abroad partner workspace:',
        verificationUrl,
        '',
        'This link expires in 24 hours and can be used only once.',
        'If you did not request this account, you can ignore this email.',
      ].join('\n'),
      to: [input.email],
    }

    for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
      try {
        const response = await axios.post(RESEND_EMAIL_ENDPOINT, request, {
          headers: {
            'Authorization': `Bearer ${configuration.apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `partner-signup/${input.tokenId}`,
            'User-Agent': 'abroad-partner-portal/1.0',
          },
          maxRedirects: 0,
          timeout: REQUEST_TIMEOUT_MS,
          validateStatus: status => status >= 200 && status < 300,
        })
        const parsedResponse = resendResponseSchema.safeParse(response.data)
        if (!parsedResponse.success) {
          throw new PartnerPortalEmailDeliveryError('PROVIDER_RESPONSE_INVALID')
        }
        return { providerMessageId: parsedResponse.data.id }
      }
      catch (error) {
        if (error instanceof PartnerPortalEmailDeliveryError) {
          throw error
        }
        const retryable = this.isRetryable(error)
        if (!retryable || attempt === MAX_DELIVERY_ATTEMPTS) {
          throw new PartnerPortalEmailDeliveryError(
            retryable ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_REJECTED',
          )
        }
        await this.delay(RETRY_DELAY_MS)
      }
    }

    throw new PartnerPortalEmailDeliveryError('PROVIDER_UNAVAILABLE')
  }

  private buildVerificationUrl(publicUrl: URL, plaintextToken: string): string {
    const verificationUrl = new URL('/partner/verify-email', publicUrl)
    verificationUrl.hash = new URLSearchParams({ token: plaintextToken }).toString()
    return verificationUrl.toString()
  }

  private delay(durationMs: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, durationMs))
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, character => ({
      '"': '&quot;',
      '&': '&amp;',
      '\'': '&#39;',
      '<': '&lt;',
      '>': '&gt;',
    })[character] ?? character)
  }

  private isRetryable(error: unknown): boolean {
    if (!axios.isAxiosError(error)) {
      return false
    }
    const status = error.response?.status
    return status === undefined || status === 429 || status >= 500
  }

  private async readConfiguration(): Promise<{
    apiKey: string
    from: string
    publicUrl: URL
  }> {
    try {
      const secrets = await this.secretManager.getSecrets([
        'RESEND_API_KEY',
        'PARTNER_PORTAL_EMAIL_FROM',
        'PARTNER_PORTAL_PUBLIC_URL',
      ] as const)
      const apiKey = secrets.RESEND_API_KEY.trim()
      const from = secrets.PARTNER_PORTAL_EMAIL_FROM.trim()
      const publicUrl = new URL(secrets.PARTNER_PORTAL_PUBLIC_URL.trim())
      if (
        apiKey.length < 20
        || apiKey.length > 512
        || from.length < 3
        || from.length > 320
        || /[\r\n]/.test(from)
        || publicUrl.protocol !== 'https:'
        || publicUrl.username.length > 0
        || publicUrl.password.length > 0
        || publicUrl.search.length > 0
        || publicUrl.hash.length > 0
      ) {
        throw new Error('Invalid email configuration')
      }
      return { apiKey, from, publicUrl }
    }
    catch {
      throw new PartnerPortalEmailDeliveryError('CONFIGURATION_INVALID')
    }
  }
}
