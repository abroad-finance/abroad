const SESSION_KEY = 'ab_session'

interface SessionData {
  address: string
  chainId: string
  walletId: string
}

const isBrowser = typeof window !== 'undefined'

const readSession = (): SessionData | null => {
  if (!isBrowser) return null
  try {
    const stored = window.localStorage.getItem(SESSION_KEY)
    if (!stored) return null
    return JSON.parse(stored) as SessionData
  }
  catch {
    return null
  }
}

const writeSession = (data: SessionData | null) => {
  if (!isBrowser) return
  try {
    if (data) {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(data))
    }
    else {
      window.localStorage.removeItem(SESSION_KEY)
    }
  }
  catch {
    // Swallow storage failures
  }
}

export const sessionStore = {
  clear: () => writeSession(null),
  get: readSession,
  set: (data: SessionData) => writeSession(data),
}
