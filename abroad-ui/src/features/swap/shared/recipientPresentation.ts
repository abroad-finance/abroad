export const maskRecipient = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 4) return '••••'
  return `${trimmed.slice(0, 2)}${'•'.repeat(Math.min(8, trimmed.length - 4))}${trimmed.slice(-2)}`
}
