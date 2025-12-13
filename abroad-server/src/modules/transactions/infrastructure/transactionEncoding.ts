export function uuidToBase64(uuid: string): string {
  const hex = uuid.replace(/-/g, '')
  const buffer = Buffer.from(hex, 'hex')
  return buffer.toString('base64')
}
