import { isValidAddressForChain } from '../wallets/shared/wallet-utils'

const SESSION_KEY = 'ab_session'

interface SessionData {
  address: string
  chainId: string
  timestamp?: number // Para validar expiración
  walletId: string
}

const isBrowser = globalThis.window !== undefined

const readSession = (): null | SessionData => {
  if (!isBrowser) return null
  try {
    const stored = globalThis.localStorage.getItem(SESSION_KEY)
    if (!stored) return null
    return JSON.parse(stored) as SessionData
  }
  catch {
    return null
  }
}

const writeSession = (data: null | SessionData) => {
  if (!isBrowser) return
  try {
    if (data) {
      // Agregar timestamp si no existe
      const dataWithTimestamp = { ...data, timestamp: Date.now() }
      globalThis.localStorage.setItem(SESSION_KEY, JSON.stringify(dataWithTimestamp))
    }
    else {
      globalThis.localStorage.removeItem(SESSION_KEY)
    }
  }
  catch {
    // Swallow storage failures
  }
}

/**
 * Valida que la sesión sea íntegra
 */
function validateSession(session: SessionData): boolean {
  // Validar que el address coincida con el formato del chainId
  if (!isValidAddressForChain(session.address, session.chainId)) {
    return false
  }

  // Validar timestamp (expiración después de 24h)
  if (session.timestamp) {
    const age = Date.now() - session.timestamp
    const MAX_AGE = 24 * 60 * 60 * 1000 // 24 horas
    if (age > MAX_AGE) return false
  }

  return true
}

export const sessionStore = {
  clear: () => writeSession(null),
  get: readSession,
  /**
   * Valida que la sesión sea íntegra
   */
  isValid: (): boolean => {
    const session = readSession()
    if (!session) return false
    return validateSession(session)
  },
  set: (data: SessionData) => writeSession(data),
}
