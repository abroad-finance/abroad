// Minimal safe type-guard for objects that have a string `message` property.
export const hasMessage = (v: unknown): v is { message: string } => typeof v === 'object' && v !== null && 'message' in v && typeof (v as Record<string, unknown>)['message'] === 'string'
