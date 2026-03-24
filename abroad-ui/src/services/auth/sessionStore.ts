const SESSION_KEY = 'ab_session'

interface SessionData {
  address: string
  chainId: string
  walletId: string
  timestamp?: number // Para validar expiración
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
 * Valida que un address tenga el formato correcto para un chainId dado
 */
function isValidAddressForChain(address: string, chainId: string): boolean {
  if (!address) return false

  if (chainId.startsWith('eip155')) {
    // Ethereum/Celo: debe empezar con 0x y tener 42 caracteres
    return /^0x[a-fA-F0-9]{40}$/.test(address)
  }

  if (chainId.startsWith('solana')) {
    // Solana: base58, longitud típica 32-44 caracteres
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)
  }

  if (chainId.startsWith('stellar')) {
    // Stellar: empieza con G (pública) o S (privada), 56 caracteres
    return /^[GS][a-zA-Z0-9]{55}$/.test(address)
  }

  return false
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
  set: (data: SessionData) => writeSession(data),
  /**
   * Valida que la sesión sea íntegra
   */
  isValid: (): boolean => {
    const session = readSession()
    if (!session) return false
    return validateSession(session)
  },
}
