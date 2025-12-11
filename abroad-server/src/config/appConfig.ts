import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const envSchema = z.object({
  AXIOS_TIMEOUT_MS: z.union([z.string(), z.number()]).optional(),
  HEALTH_PORT: z.union([z.string(), z.number()]).optional(),
  NODE_ENV: z.string().optional(),
  PORT: z.union([z.string(), z.number()]).optional(),
  PUBSUB_ACK_DEADLINE_SECONDS: z.union([z.string(), z.number()]).optional(),
  PUBSUB_SUBSCRIPTION_SUFFIX: z.string().optional(),
  SECRET_CACHE_TTL_MS: z.union([z.string(), z.number()]).optional(),
  SHUTDOWN_TIMEOUT_MS: z.union([z.string(), z.number()]).optional(),
  WS_PORT: z.union([z.string(), z.number()]).optional(),
})

export type RuntimeConfiguration = {
  axiosTimeoutMs: number
  pubSub: {
    ackDeadlineSeconds: number
    subscriptionSuffix: string
  }
  secrets: {
    cacheTtlMs: number
  }
  server: {
    healthPort: number
    port: number
    shutdownTimeoutMs: number
  }
  websocket: {
    port: number
  }
}

export function buildRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfiguration {
  const parsed = envSchema.parse(env)
  const coercePositiveNumber = (value: unknown, fallback: number) => {
    const parsedValue = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback
  }

  const serverPort = coercePositiveNumber(parsed.PORT, 3784)
  const healthPort = coercePositiveNumber(parsed.HEALTH_PORT ?? serverPort, 3000)

  return {
    axiosTimeoutMs: coercePositiveNumber(parsed.AXIOS_TIMEOUT_MS, 10_000),
    pubSub: {
      ackDeadlineSeconds: coercePositiveNumber(parsed.PUBSUB_ACK_DEADLINE_SECONDS, 30),
      subscriptionSuffix: parsed.PUBSUB_SUBSCRIPTION_SUFFIX ?? '-subscription',
    },
    secrets: {
      cacheTtlMs: coercePositiveNumber(parsed.SECRET_CACHE_TTL_MS, 300_000),
    },
    server: {
      healthPort,
      port: serverPort,
      shutdownTimeoutMs: coercePositiveNumber(parsed.SHUTDOWN_TIMEOUT_MS, 10_000),
    },
    websocket: {
      port: coercePositiveNumber(parsed.WS_PORT, 8080),
    },
  }
}

export const RuntimeConfig = buildRuntimeConfig()
