import { z } from 'zod'

export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
type JsonPrimitive = boolean | null | number | string

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)
