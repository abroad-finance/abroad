import { Container } from 'inversify'

import { ConsoleLogger } from '../../core/logging/consoleLogger'
import { KycService } from '../../modules/kyc/application/KycService'
import { GcsKycDocumentStorage } from '../../modules/kyc/infrastructure/GcsKycDocumentStorage'
import { FirebaseOpsIdentityProvider } from '../../modules/operations/infrastructure/FirebaseOpsIdentityProvider'
import { PartnerService } from '../../modules/partners/application/partnerService'
import { PostgresAdvisoryLockManager } from '../../platform/cacheLock/postgresAdvisoryLockManager'
import { GCPPubSubQueueHandler } from '../../platform/messaging/gcpPubSubQueueHandler'
import { SlackNotifier } from '../../platform/notifications/slackNotifier'
import { SocketIOWebSocketService } from '../../platform/notifications/socketIoWebSocketService'
import { WebhookNotifier } from '../../platform/notifications/webhookNotifier'
import { WebhookTargetPolicy } from '../../platform/notifications/WebhookTargetPolicy'
import { OutboxDispatcher } from '../../platform/outbox/OutboxDispatcher'
import { OutboxRepository } from '../../platform/outbox/OutboxRepository'
import { OutboxWorker } from '../../platform/outbox/OutboxWorker'
import { PrismaClientProvider } from '../../platform/persistence/prismaClientProvider'
import { CachedSecretManager } from '../../platform/secrets/CachedSecretManager'
import { OpsAuthService } from '../http/OpsAuthService'
import { BindingRegistration, registerBindings } from './bindingSupport'
import { TYPES } from './types'

const infrastructureBindings: ReadonlyArray<BindingRegistration<unknown>> = [
  { bindSelf: true, identifier: OutboxRepository, implementation: OutboxRepository },
  { identifier: TYPES.IOutboxDispatcher, implementation: OutboxDispatcher },
  { identifier: TYPES.OutboxWorker, implementation: OutboxWorker },
  { identifier: TYPES.IQueueHandler, implementation: GCPPubSubQueueHandler },
  { identifier: TYPES.IDatabaseClientProvider, implementation: PrismaClientProvider },
  { identifier: TYPES.ISecretManager, implementation: CachedSecretManager },
  { identifier: TYPES.ILogger, implementation: ConsoleLogger },
  { identifier: TYPES.ISlackNotifier, implementation: SlackNotifier },
  { identifier: TYPES.IWebSocketService, implementation: SocketIOWebSocketService },
  { identifier: TYPES.IWebhookNotifier, implementation: WebhookNotifier },
  { bindSelf: true, identifier: WebhookTargetPolicy, implementation: WebhookTargetPolicy },
  { identifier: TYPES.ILockManager, implementation: PostgresAdvisoryLockManager },
  { identifier: TYPES.IPartnerService, implementation: PartnerService },
  { identifier: TYPES.IKycService, implementation: KycService },
  { identifier: TYPES.IKycDocumentStorage, implementation: GcsKycDocumentStorage },
  { identifier: TYPES.IOpsAuthService, implementation: OpsAuthService },
  { identifier: TYPES.IOpsIdentityProvider, implementation: FirebaseOpsIdentityProvider },
] as const

export function bindInfrastructure(container: Container): void {
  registerBindings(container, infrastructureBindings)
}
