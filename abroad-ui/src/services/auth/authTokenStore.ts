const TOKEN_STORAGE_KEY = 'token'

type TokenListener = (token: null | string) => void

const isBrowser = typeof window !== 'undefined'

const readToken = (): null | string => {
  if (!isBrowser) return null
  try {
    const stored = window.localStorage.getItem(TOKEN_STORAGE_KEY)
    return stored || null
  }
  catch {
    return null
  }
}

const writeToken = (token: null | string) => {
  if (!isBrowser) return
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
    }
    else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY)
    }
  }
  catch {
    // Swallow storage failures; consumers will continue with in-memory token.
  }
}

export class AuthTokenStore {
  private readonly listeners = new Set<TokenListener>()

  private token: null | string

  constructor(initialToken: null | string = readToken()) {
    this.token = initialToken
  }

  getToken(): null | string {
    return this.token
  }

  setToken(token: null | string): void {
    this.token = token
    writeToken(token)
    this.listeners.forEach(listener => listener(token))
  }

  subscribe(listener: TokenListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

export const authTokenStore = new AuthTokenStore()
