import 'reflect-metadata'
import axios from 'axios'

import { PartnerPortalEmailDeliveryError, ResendPartnerPortalEmailSender } from '../../../../modules/partners/application/ResendPartnerPortalEmailSender'
import { ISecretManager } from '../../../../platform/secrets/ISecretManager'

const configuration = {
  PARTNER_PORTAL_EMAIL_FROM: 'Abroad <access@auth.abroad.finance>',
  PARTNER_PORTAL_PUBLIC_URL: 'https://app.abroad.finance',
  RESEND_API_KEY: 're_test_key_that_is_long_enough',
}

const input = {
  email: 'admin@atlas.example',
  firstName: 'Ana <Admin>',
  plaintextToken: 'v'.repeat(43),
  tokenId: '33333333-3333-4333-8333-333333333333',
}

const buildHarness = (secrets: typeof configuration = configuration) => {
  const getSecrets = jest.fn(async () => secrets)
  const secretManager = {
    getSecret: jest.fn(),
    getSecrets,
  } as unknown as ISecretManager
  return {
    getSecrets,
    sender: new ResendPartnerPortalEmailSender(secretManager),
  }
}

describe('ResendPartnerPortalEmailSender', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('sends an escaped text and HTML verification message with provider idempotency', async () => {
    const post = jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: { id: 'resend-message-1' },
    })
    const harness = buildHarness()

    const result = await harness.sender.sendVerificationEmail(input)

    expect(result).toEqual({ providerMessageId: 'resend-message-1' })
    expect(post).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        from: configuration.PARTNER_PORTAL_EMAIL_FROM,
        subject: 'Verify your Abroad partner account',
        to: [input.email],
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Idempotency-Key': `partner-signup/${input.tokenId}`,
        }),
        maxRedirects: 0,
        timeout: 7_000,
      }),
    )
    const payload = post.mock.calls[0]?.[1] as { html: string, text: string }
    expect(payload.html).toContain('Ana &lt;Admin&gt;')
    expect(payload.html).not.toContain('Ana <Admin>')
    expect(payload.text).toContain(
      `https://app.abroad.finance/partner/verify-email#token=${input.plaintextToken}`,
    )
  })

  it('retries one transient provider failure with the same idempotency key', async () => {
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true)
    const post = jest.spyOn(axios, 'post')
      .mockRejectedValueOnce({ response: { status: 503 } })
      .mockResolvedValueOnce({ data: { id: 'resend-message-2' } })

    const result = await buildHarness().sender.sendVerificationEmail(input)

    expect(result.providerMessageId).toBe('resend-message-2')
    expect(post).toHaveBeenCalledTimes(2)
    const firstHeaders = post.mock.calls[0]?.[2]?.headers
    const secondHeaders = post.mock.calls[1]?.[2]?.headers
    expect(firstHeaders).toEqual(expect.objectContaining({
      'Idempotency-Key': `partner-signup/${input.tokenId}`,
    }))
    expect(secondHeaders).toEqual(firstHeaders)
  })

  it('does not retry a provider rejection and never exposes its response body', async () => {
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true)
    const post = jest.spyOn(axios, 'post').mockRejectedValueOnce({
      response: {
        data: { message: 'sensitive provider detail' },
        status: 400,
      },
    })

    await expect(buildHarness().sender.sendVerificationEmail(input)).rejects.toEqual(
      new PartnerPortalEmailDeliveryError('PROVIDER_REJECTED'),
    )
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('fails closed for invalid provider responses and configuration', async () => {
    jest.spyOn(axios, 'post').mockResolvedValueOnce({ data: { accepted: true } })
    await expect(buildHarness().sender.sendVerificationEmail(input)).rejects.toEqual(
      new PartnerPortalEmailDeliveryError('PROVIDER_RESPONSE_INVALID'),
    )

    jest.restoreAllMocks()
    const post = jest.spyOn(axios, 'post')
    await expect(buildHarness({
      ...configuration,
      PARTNER_PORTAL_PUBLIC_URL: 'http://app.abroad.finance',
    }).sender.sendVerificationEmail(input)).rejects.toEqual(
      new PartnerPortalEmailDeliveryError('CONFIGURATION_INVALID'),
    )
    expect(post).not.toHaveBeenCalled()
  })

  it('normalizes secret-manager failures without including their message', async () => {
    const harness = buildHarness()
    harness.getSecrets.mockRejectedValueOnce(new Error('secret payload should not escape'))

    const error = await harness.sender.sendVerificationEmail(input).catch(value => value)

    expect(error).toEqual(new PartnerPortalEmailDeliveryError('CONFIGURATION_INVALID'))
    expect(String(error)).not.toContain('secret payload should not escape')
  })
})
