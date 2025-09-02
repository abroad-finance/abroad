import SignClient from '@walletconnect/sign-client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/**
 * useLobstrAutoConnect
 *
 * A React hook that implements the "auto-connect" flow described by Aquarius for LOBSTR + WalletConnect/Reown.
 *
 * Intended usage: mount this hook on a minimally styled route like
 *   https://app.abroad.finance/lobstr?redirect=/
 * The page shows your app chrome + a spinner. As soon as it mounts:
 *   1) It initializes a WalletConnect (Reown Sign) client
 *   2) Creates a pairing & generates a WalletConnect URI
 *   3) Sends the URI to the wallet webview using postMessage(), so LOBSTR can auto-approve
 *   4) Waits for session approval
 *   5) Redirects the user to `redirect` (or a default) with a connected session
 *
 * The hook also persists the session in localStorage and exposes convenient state for UI.
 *
 * Requirements:
 *  - A Reown/WalletConnect Project ID (https://dashboard.reown.com)
 *  - Your app should be opened inside LOBSTR's in-app webview (they will open your special URL)
 *  - Your backend/app should handle the connected session (e.g. store addresses, enable signing)
 *
 * Notes:
 *  - Stellar CAIP-2 chain IDs are `stellar:pubnet` and `stellar:testnet`.
 *  - Common Stellar WC methods: `stellar_signXDR`, `stellar_signAndSubmitXDR`.
 *
 * Example (Next.js page component):
 *
 *   export default function LobstrAutoConnectPage() {
 *     const { status, error } = useLobstrAutoConnect({
 *       projectId: process.env.NEXT_PUBLIC_REOWN_PROJECT_ID!,
 *       // optional
 *       defaultRedirect: "/",
 *       chains: ["stellar:pubnet"],
 *       metadata: {
 *         name: "Abroad Finance",
 *         description: "Abroad Finance dApp",
 *         url: "https://app.abroad.finance",
 *         icons: ["https://app.abroad.finance/icon.png"],
 *       },
 *     });
 *
 *     return (
 *       <main>
 *         <h1>Connecting your wallet…</h1>
 *         {status === "error" && <p>Failed to connect: {String(error)}</p>}
 *       </main>
 *     );
 *   }
 */

export type LobstrAutoConnectStatus
  = | 'connected'
    | 'error'
    | 'generating_uri'
    | 'idle'
    | 'initializing'
    | 'restored'
    | 'waiting_approval'

export interface UseLobstrAutoConnectOptions {
  /** Whether to start immediately on mount (default: true). */
  autoStart?: boolean
  /** CAIP-2 chains to request. Defaults to ["stellar:pubnet"]. */
  chains?: string[]
  /** Enable verbose logging to console (default: false). */
  debug?: boolean
  /** Fallback redirect if query is missing (default: "/"). */
  defaultRedirect?: string
  /** Events to request. */
  events?: string[]
  /** Dapp metadata shown in wallet */
  /** Optional: custom logger handler. Receives level and message. */
  logger?: (level: 'error' | 'info' | 'warn', message: string) => void

  metadata?: {
    description: string
    icons: string[]
    name: string
    url: string
  }
  /** Methods to request. Defaults to Stellar signing methods. */
  methods?: string[]
  /** Optional: callback invoked when a session is established. */
  onConnected?: (session: unknown, accounts: string[]) => void
  /** Origin to use for window.postMessage (default: "*"). */
  postMessageOrigin?: string
  /** Reown / WalletConnect Cloud Project ID */
  projectId: string
  /** Query param containing redirect path (default: "redirect"). */
  redirectParam?: string
  /** Relay URL override */
  relayUrl?: string
}

export interface UseLobstrAutoConnectResult {
  accounts: string[]
  /** Best-effort cancellation for pending connect. */
  cancel: () => Promise<void>
  error?: unknown
  /** Redirect helper. */
  redirect: (to?: string) => void
  session?: unknown
  /** Manually start autoconnect if autoStart=false. */
  start: () => Promise<void>
  status: LobstrAutoConnectStatus
  uri?: string
}

const isBrowser = typeof window !== 'undefined'

const DEFAULT_METHODS = ['stellar_signXDR', 'stellar_signAndSubmitXDR']

export function useLobstrAutoConnect(options: UseLobstrAutoConnectOptions): UseLobstrAutoConnectResult {
  const {
    autoStart = true,
    chains = ['stellar:pubnet'],
    debug = false,
    defaultRedirect = '/',
    events = [],
    logger,
    metadata,
    methods = DEFAULT_METHODS,
    onConnected,
    postMessageOrigin = '*',
    projectId,
    redirectParam = 'redirect',
    relayUrl,
  } = options

  const [status, setStatus] = useState<LobstrAutoConnectStatus>('idle')
  const [error, setError] = useState<unknown>(undefined)
  const [uri, setUri] = useState<string | undefined>(undefined)
  const [session, setSession] = useState<unknown>(undefined)
  const [accounts, setAccounts] = useState<string[]>([])

  const signClientRef = useRef<Awaited<ReturnType<typeof SignClient.init>> | null>(null)
  const pairingTopicRef = useRef<null | string>(null)
  const stopRetryRef = useRef<boolean>(false)
  const approvalPromiseRef = useRef<(() => Promise<unknown>) | null>(null)

  const redirectTarget = useMemo(() => getRedirectFromQuery(redirectParam, defaultRedirect), [redirectParam, defaultRedirect])

  // Simple, safe logger with optional external override
  const log = useMemo(() => {
    const emit = (level: 'error' | 'info' | 'warn', parts: unknown[]) => {
      if (!debug) return
      const msg = ['[LobstrAutoConnect]', ...parts.map((p) => {
        try {
          return typeof p === 'string' ? p : JSON.stringify(p)
        }
        catch {
          return String(p)
        }
      })].join(' ')
      try {
        if (logger) return logger(level, msg)
        if (level === 'error') console.error(msg)
        else if (level === 'info') console.log(msg)
        else console.warn(msg)
      }
      catch {
        // ignore logger failures
      }
    }
    return {
      error: (...parts: unknown[]) => emit('error', parts),
      info: (...parts: unknown[]) => emit('info', parts),
      warn: (...parts: unknown[]) => emit('warn', parts),
    }
  }, [debug, logger])

  const redirect = useCallback((to?: string) => {
    if (!isBrowser) return
    const target = to || redirectTarget
    log.info('Redirecting to', target)
    try {
      window.location.replace(target)
    }
    catch {
      window.location.href = target
    }
  }, [log, redirectTarget])

  const initClient = useCallback(async () => {
    if (signClientRef.current) return signClientRef.current
    setStatus('initializing')
    log.info('Initializing WalletConnect SignClient', {
      metadata: metadata?.name || null,
      projectId: `${String(projectId).slice(0, 2)}***${String(projectId).slice(-2)}`,
      relayUrl: relayUrl || null,
    })
    const client = await SignClient.init({
      metadata,
      projectId,
      relayUrl,
    })

    // basic listeners
    client.on('session_update', ({ params, topic }) => {
      try {
        const namespaces = (params as unknown as { namespaces?: unknown })?.namespaces
        const existing = client.session.get(topic as string)
        const updated = { ...(existing as object), namespaces }
        setSession(updated)
        setAccounts(extractStellarAccounts(updated))
        log.info('session_update received for topic', topic)
      }
      catch (err) {
        log.error('session_update handler failed', err)
      }
    })

    client.on('session_delete', () => {
      // No-op here, the redirect page is ephemeral; your app may want to clear state.
      log.warn('session_delete received')
      return
    })

    signClientRef.current = client
    log.info('SignClient initialized')
    return client
  }, [
    log,
    metadata,
    projectId,
    relayUrl,
  ])

  const sendUriWithRetries = useCallback((u: string) => {
    setUri(u)
    // fire immediately
    log.info('Sending WalletConnect URI to wallet')
    postUriToWallet(u, postMessageOrigin)
    // and a short burst of retries (helps when native webview bridge spins up a bit late)
    stopRetryRef.current = false
    let tries = 0
    const id = setInterval(() => {
      if (stopRetryRef.current || tries >= 10) {
        clearInterval(id)
        return
      }
      tries += 1
      log.info('Retry sending WalletConnect URI', `attempt=${tries}`)
      postUriToWallet(u, postMessageOrigin)
    }, 250)
  }, [log, postMessageOrigin])

  const start = useCallback(async () => {
    try {
      const client = await initClient()

      // If there's an existing session, skip straight to redirect
      const existingSessions = client.session.getAll()
      if (existingSessions.length > 0) {
        const last = existingSessions[existingSessions.length - 1]
        setSession(last)
        setAccounts(extractStellarAccounts(last))
        setStatus('restored')
        // redirect asap with an already-connected session
        log.info('Existing session found; redirecting immediately')
        redirect()
        return
      }

      setStatus('generating_uri')
      log.info('Requesting connection; generating WalletConnect URI')

      // Create a new session proposal; returns uri (if no prior pairing) and an approval resolver
      const { approval, uri: wcUri } = await client.connect({
        pairingTopic: pairingTopicRef.current || undefined,
        requiredNamespaces: {
          stellar: {
            chains,
            events,
            methods,
          },
        },
      })

      approvalPromiseRef.current = approval

      if (wcUri) {
        log.info('Received WalletConnect URI')
        sendUriWithRetries(wcUri)
      }
      else {
        log.info('Reusing existing pairing; no URI generated')
      }

      setStatus('waiting_approval')
      log.info('Waiting for wallet approval…')

      // Wait for wallet confirmation
      const _session = await approval()
      stopRetryRef.current = true // stop resending URI once paired
      setSession(_session)
      const accs = extractStellarAccounts(_session)
      setAccounts(accs)
      setStatus('connected')
      log.info('Session approved; accounts:', accs)
      try {
        localStorage.setItem('wc_stellar_session', JSON.stringify(_session))
      }
      catch (err) {
        log.warn('Failed to persist session to localStorage', err)
      }
      onConnected?.(_session, accs)

      // Redirect to the requested page inside your app
      redirect()
    }
    catch (err) {
      stopRetryRef.current = true
      setError(err)
      setStatus('error')
      log.error('Auto-connect failed', err)
    }
  }, [
    chains,
    events,
    initClient,
    log,
    methods,
    onConnected,
    redirect,
    sendUriWithRetries,
  ])

  const cancel = useCallback(async () => {
    try {
      log.info('Cancel requested')
      stopRetryRef.current = true
      const client = signClientRef.current
      const topic = pairingTopicRef.current
      if (client && topic) {
        // Best-effort: delete pairing if we created one
        try {
          log.info('Disconnecting pairing', topic)
          await client.core.pairing.disconnect({ topic })
        }
        catch (err) {
          log.warn('Failed to disconnect pairing', err)
        }
      }
    }
    catch (err) {
      log.warn('Cancel failed', err)
    }
  }, [log])

  useEffect(() => {
    if (!autoStart) return
    // Avoid SSR issues
    if (!isBrowser) return
    start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart])

  return {
    accounts,
    cancel,
    error,
    redirect,
    session,
    start,
    status,
    uri,
  }
}

function extractStellarAccounts(session: unknown): string[] {
  try {
    const ns = (session as unknown as { namespaces?: { stellar?: { accounts?: string[] } } })?.namespaces?.stellar
    if (!ns) return []
    const accounts: string[] = ns.accounts || []
    // CAIP-10 account format: "stellar:pubnet:G..."
    return accounts
      .map(a => a.split(':')[2])
      .filter(Boolean)
  }
  catch (err) {
    void err
    return []
  }
}

function getRedirectFromQuery(param = 'redirect', fallback = '/'): string {
  if (!isBrowser) return fallback
  try {
    const url = new URL(window.location.href)
    const target = url.searchParams.get(param)
    if (!target) return fallback
    // prevent open redirect to other origins; allow only same-origin paths
    const isAbsolute = /^https?:\/\//i.test(target)
    if (isAbsolute) {
      try {
        const t = new URL(target)
        if (t.origin === window.location.origin) return t.pathname + t.search + t.hash
        // If different origin, drop to safe fallback
        return fallback
      }
      catch {
        return fallback
      }
    }
    return target.startsWith('/') ? target : `/${target}`
  }
  catch (err) {
    void err
    return fallback
  }
}

function postUriToWallet(uri: string, origin = '*') {
  const payload = JSON.stringify({ type: 'walletconnect_uri', uri })
  // 1) React Native WebView (Android/iOS)
  // See: https://github.com/react-native-webview/react-native-webview
  try {
    const w = window as typeof window & { ReactNativeWebView?: { postMessage: (payload: string) => void } }
    if (isBrowser && w.ReactNativeWebView && typeof w.ReactNativeWebView.postMessage === 'function') {
      w.ReactNativeWebView.postMessage(payload)
    }
  }
  catch (err) {
    void err
  }
  // 2) Generic in-app webviews relying on window.postMessage to parent
  try {
    if (isBrowser && window.parent && typeof window.parent.postMessage === 'function') {
      window.parent.postMessage({ type: 'walletconnect_uri', uri }, origin)
    }
  }
  catch (err) {
    void err
  }
  // 3) (Optional) iOS WKWebView message handlers – no-op unless host app injected one
  try {
    const w = window as typeof window & { webkit?: { messageHandlers?: { walletconnect?: { postMessage: (message: { uri: string }) => void } } } }
    if (isBrowser && w.webkit?.messageHandlers?.walletconnect) {
      w.webkit.messageHandlers.walletconnect.postMessage({ uri })
    }
  }
  catch (err) {
    void err
  }
}
