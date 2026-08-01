import 'reflect-metadata'

import type { PartnerWebhookConfiguration, PrismaClient } from '@prisma/client'

import { WebhookCredentialMode } from '@prisma/client'

import { PartnerPortalSecretEnvelopeService } from '../../../../modules/partners/application/PartnerPortalSecretEnvelopeService'
import { PartnerWebhookSecretResolver } from '../../../../modules/partners/application/PartnerWebhookSecretResolver'
import { IDatabaseClientProvider } from '../../../../platform/persistence/IDatabaseClientProvider'

const configuration: PartnerWebhookConfiguration = {
  activeSecretCiphertext: 'active-envelope',
  activeSecretPrefix: 'whsec_active',
  activeSecretVersion: 1,
  createdAt: new Date('2026-08-01T12:00:00.000Z'),
  lastTestDurationMs: null,
  lastTestedAt: null,
  lastTestedRevision: null,
  lastTestFailureCode: null,
  lastTestHttpStatus: null,
  lastTestSucceeded: null,
  partnerId: 'partner-1',
  pendingRevision: 2,
  pendingSecretCiphertext: 'pending-envelope',
  pendingSecretPrefix: 'whsec_pending',
  pendingUrl: 'https://hooks.partner.example/events',
  updatedAt: new Date('2026-08-01T12:00:00.000Z'),
}

const buildHarness = (stored: null | PartnerWebhookConfiguration = configuration) => {
  const findUnique = jest.fn(async () => stored)
  const databaseClientProvider: IDatabaseClientProvider = {
    getClient: jest.fn(async () => ({
      partnerWebhookConfiguration: { findUnique },
    }) as unknown as PrismaClient),
  }
  const decrypt = jest.fn(async (envelope: string, context: string) => `${envelope}:${context}`)
  const secretEnvelopeService = { decrypt }
  return {
    decrypt,
    findUnique,
    resolver: new PartnerWebhookSecretResolver(
      databaseClientProvider,
      secretEnvelopeService as unknown as PartnerPortalSecretEnvelopeService,
    ),
  }
}

describe('PartnerWebhookSecretResolver', () => {
  it('resolves current and pending credential modes from their exact envelopes', async () => {
    const harness = buildHarness()

    await expect(harness.resolver.resolve(
      'partner-1',
      WebhookCredentialMode.PARTNER_CURRENT,
    )).resolves.toBe('active-envelope:partner-portal:webhook:partner-1:active')
    await expect(harness.resolver.resolve(
      'partner-1',
      WebhookCredentialMode.PARTNER_PENDING,
    )).resolves.toBe('pending-envelope:partner-portal:webhook:partner-1:pending')
  })

  it('does not fall back from a missing pending secret to the active secret', async () => {
    const harness = buildHarness({ ...configuration, pendingSecretCiphertext: null })

    await expect(harness.resolver.resolve(
      'partner-1',
      WebhookCredentialMode.PARTNER_PENDING,
    )).resolves.toBeUndefined()
    expect(harness.decrypt).not.toHaveBeenCalled()
  })

  it('leaves legacy resolution to the origin-based secret provider without a database read', async () => {
    const harness = buildHarness()

    await expect(harness.resolver.resolve(
      'partner-1',
      WebhookCredentialMode.LEGACY_ORIGIN,
    )).resolves.toBeUndefined()
    expect(harness.findUnique).not.toHaveBeenCalled()
  })
})
