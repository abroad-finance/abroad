const DEFAULT_SHUTDOWN_MS = 10_000
const DEFAULT_QUEUE_ACK_DEADLINE_SECONDS = 30
const DEFAULT_QUEUE_SUBSCRIPTION_SUFFIX = '-subscription'
const DEFAULT_AXIOS_TIMEOUT_MS = 10_000

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const RuntimeConfig = {
  axiosTimeoutMs: DEFAULT_AXIOS_TIMEOUT_MS,
  pubSub: {
    ackDeadlineSeconds: parseNumber(
      process.env.PUBSUB_ACK_DEADLINE_SECONDS,
      DEFAULT_QUEUE_ACK_DEADLINE_SECONDS,
    ),
    subscriptionSuffix:
      process.env.PUBSUB_SUBSCRIPTION_SUFFIX
      ?? DEFAULT_QUEUE_SUBSCRIPTION_SUFFIX,
  },
  server: {
    healthPort: parseNumber(
      process.env.HEALTH_PORT ?? process.env.PORT,
      3000,
    ),
    port: parseNumber(process.env.PORT, 3784),
    shutdownTimeoutMs: parseNumber(
      process.env.SHUTDOWN_TIMEOUT_MS,
      DEFAULT_SHUTDOWN_MS,
    ),
  },
  websocket: {
    port: parseNumber(process.env.WS_PORT, 8080),
  },
}

export type RuntimeConfiguration = typeof RuntimeConfig
