import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const toPositiveNumber = (value: unknown, fallback: number): number => {
  const parsedValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback
}

const positiveNumberWithDefault = (fallback: number) =>
  z.preprocess(value => toPositiveNumber(value, fallback), z.number())

const envSchema = z.object({
  AXIOS_TIMEOUT_MS: positiveNumberWithDefault(10_000),
  HEALTH_PORT: z.unknown().optional(),
  NODE_ENV: z.string().optional(),
  PORT: positiveNumberWithDefault(3_784),
  PUBSUB_ACK_DEADLINE_SECONDS: positiveNumberWithDefault(30),
  PUBSUB_SUBSCRIPTION_SUFFIX: z.string().trim().optional(),
  SECRET_CACHE_TTL_MS: positiveNumberWithDefault(300_000),
  SHUTDOWN_TIMEOUT_MS: positiveNumberWithDefault(10_000),
  WS_PORT: positiveNumberWithDefault(8080),
}).transform((env): RuntimeConfiguration => {
  const serverPort = env.PORT
  const healthPort = toPositiveNumber(env.HEALTH_PORT ?? serverPort, 3_000)

  return {
    axiosTimeoutMs: env.AXIOS_TIMEOUT_MS,
    pubSub: {
      ackDeadlineSeconds: env.PUBSUB_ACK_DEADLINE_SECONDS,
      subscriptionSuffix: env.PUBSUB_SUBSCRIPTION_SUFFIX ?? '-subscription',
    },
    secrets: {
      cacheTtlMs: env.SECRET_CACHE_TTL_MS,
    },
    server: {
      healthPort,
      port: serverPort,
      shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    },
    websocket: {
      port: env.WS_PORT,
    },
  }
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
  return envSchema.parse(env)
}

export const RuntimeConfig = buildRuntimeConfig()
