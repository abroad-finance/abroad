import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react'

// Local overlay to avoid cross-zone import restrictions

interface AppLogEntry {
  args: unknown[]
  id: number
  level: LogLevel
  time: number
}

type LogLevel = 'debug' | 'error' | 'info' | 'log' | 'warn'

declare global {
  interface Window {
    __appLogPatched?: boolean
    __appLogs?: AppLogEntry[]
    __appLogSeq?: number
  }
}

const MAX_LOGS = 500

function formatArg(arg: unknown): string {
  try {
    if (typeof arg === 'string') return arg
    if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`
    return JSON.stringify(arg, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)
  }
  catch {
    // Fallback to toString if circular or non-serializable
    try {
      return String(arg)
    }
    catch {
      return '[Unserializable]'
    }
  }
}

export const HiddenLogViewer: React.FC = () => {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<Record<LogLevel, boolean>>({
    debug: true,
    error: true,
    info: true,
    log: true,
    warn: true,
  })
  const [logs, setLogs] = useState<AppLogEntry[]>(() => window.__appLogs ?? [])

  const bottomRef = useRef<HTMLDivElement | null>(null)

  // Patch console once; keep a global ring buffer on window
  useEffect(() => {
    if (window.__appLogPatched) return
    window.__appLogPatched = true
    window.__appLogs = window.__appLogs ?? []
    window.__appLogSeq = window.__appLogSeq ?? 1

    const original = {
      debug: console.debug ? console.debug.bind(console) : console.log.bind(console),
      error: console.error.bind(console),
      info: console.info.bind(console),
      log: console.log.bind(console),
      warn: console.warn.bind(console),
    }

    const push = (level: LogLevel, args: unknown[]) => {
      try {
        const entry: AppLogEntry = {
          args,
          id: (window.__appLogSeq = (window.__appLogSeq ?? 0) + 1),
          level,
          time: Date.now(),
        }
        if (!window.__appLogs) window.__appLogs = []
        const store = window.__appLogs
        store.push(entry)
        if (store.length > MAX_LOGS) store.splice(0, store.length - MAX_LOGS)
        // Fire a custom event so listeners can update without tight coupling
        window.dispatchEvent(new CustomEvent('app-log', { detail: entry }))
      }
      catch {
        // ignore logging failures
      }
    }

    console.log = (...a: unknown[]) => {
      original.log(...a)
      push('log', a)
    }
    console.info = (...a: unknown[]) => {
      original.info(...a)
      push('info', a)
    }
    console.warn = (...a: unknown[]) => {
      original.warn(...a)
      push('warn', a)
    }
    console.error = (...a: unknown[]) => {
      original.error(...a)
      push('error', a)
    }
    console.debug = (...a: unknown[]) => {
      original.debug(...a)
      push('debug', a)
    }
  }, [])

  // Subscribe to new logs
  useEffect(() => {
    const handler = () => setLogs([...(window.__appLogs ?? [])])
    window.addEventListener('app-log', handler)
    return () => window.removeEventListener('app-log', handler)
  }, [])

  // Autoscroll when open
  useEffect(() => {
    if (!open) return
    const el = bottomRef.current
    if (el) el.scrollIntoView({ behavior: 'smooth' })
  }, [open, logs])

  const clear = useCallback(() => {
    window.__appLogs = []
    setLogs([])
  }, [])

  const copyAll = useCallback(() => {
    const text = (window.__appLogs ?? [])
      .map((l) => {
        const ts = new Date(l.time).toISOString()
        const msg = l.args.map(formatArg).join(' ')
        return `[${ts}] ${l.level.toUpperCase()} ${msg}`
      })
      .join('\n')
    navigator.clipboard?.writeText(text).catch(() => {})
  }, [])

  const filtered = useMemo(() => logs.filter(l => filter[l.level]), [logs, filter])

  const toggleLevel = (lvl: LogLevel) =>
    setFilter(f => ({
      ...f,
      [lvl]: !f[lvl],
    }))

  if (!import.meta.env.DEV) return null

  return (
    <>
      {/* Hidden hotspot in bottom-right corner to open modal */}
      <button
        aria-label="Open in-app logs"
        className="fixed bottom-0 right-0 w-8 h-8 opacity-0 z-[1000]"
        onClick={() => setOpen(true)}
        title=""
      />

      <Overlay backdropClassName="bg-black/50 backdrop-blur-sm" onClose={() => setOpen(false)} open={open} zIndexClassName="z-[1000]">
        <div className="w-full max-w-4xl max-h-[80vh] bg-white text-black rounded-lg shadow-xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-gray-50">
            <div className="font-semibold text-sm">In-App Logs</div>
            <div className="flex items-center gap-2">
              <button
                className="text-xs px-2 py-1 rounded bg-gray-200 hover:bg-gray-300"
                onClick={copyAll}
                type="button"
              >
                Copy
              </button>
              <button
                className="text-xs px-2 py-1 rounded bg-gray-200 hover:bg-gray-300"
                onClick={clear}
                type="button"
              >
                Clear
              </button>
              <button
                aria-label="Close logs"
                className="text-xs px-2 py-1 rounded bg-gray-200 hover:bg-gray-300"
                onClick={() => setOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3 px-4 py-2 text-xs border-b border-gray-200">
            <label className="flex items-center gap-1">
              <input checked={filter.log} onChange={() => toggleLevel('log')} type="checkbox" />
              <span className="text-gray-700">log</span>
            </label>
            <label className="flex items-center gap-1">
              <input checked={filter.info} onChange={() => toggleLevel('info')} type="checkbox" />
              <span className="text-blue-700">info</span>
            </label>
            <label className="flex items-center gap-1">
              <input checked={filter.warn} onChange={() => toggleLevel('warn')} type="checkbox" />
              <span className="text-yellow-700">warn</span>
            </label>
            <label className="flex items-center gap-1">
              <input checked={filter.error} onChange={() => toggleLevel('error')} type="checkbox" />
              <span className="text-red-700">error</span>
            </label>
            <label className="flex items-center gap-1">
              <input checked={filter.debug} onChange={() => toggleLevel('debug')} type="checkbox" />
              <span className="text-purple-700">debug</span>
            </label>
            <div className="ml-auto text-gray-500">
              {filtered.length}
              {' '}
              shown
            </div>
          </div>

          <div className="flex-1 overflow-auto bg-white">
            <ul className="divide-y divide-gray-100">
              {filtered.map((l) => {
                const ts = new Date(l.time).toLocaleTimeString()
                const msg = l.args.map(formatArg).join(' ')
                const color
                  = l.level === 'error'
                    ? 'text-red-700'
                    : l.level === 'warn'
                      ? 'text-yellow-700'
                      : l.level === 'info'
                        ? 'text-blue-700'
                        : l.level === 'debug'
                          ? 'text-purple-700'
                          : 'text-gray-800'
                return (
                  <li className="px-4 py-2 text-xs font-mono whitespace-pre-wrap" key={l.id}>
                    <span className="text-gray-400">
                      [
                      {ts}
                      ]
                    </span>
                    {' '}
                    <span className={`${color} font-semibold`}>{l.level.toUpperCase()}</span>
                    {' '}
                    <span className="text-gray-900 break-words">{msg}</span>
                  </li>
                )
              })}
            </ul>
            <div ref={bottomRef} />
          </div>
        </div>
      </Overlay>
    </>
  )
}

export default HiddenLogViewer

interface OverlayProps {
  backdropClassName?: string
  children: React.ReactNode
  onClose: () => void
  open: boolean
  zIndexClassName?: string
}

const Overlay: React.FC<OverlayProps> = ({
  backdropClassName = 'bg-black/60 backdrop-blur-sm',
  children,
  onClose,
  open,
  zIndexClassName = 'z-[999]',
}) => {
  if (!open) return null
  return (
    <div
      aria-modal="true"
      className={`fixed inset-0 ${backdropClassName} ${zIndexClassName} flex items-center justify-center p-4`}
      onClick={onClose}
      role="dialog"
    >
      <div className="w-full" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}
