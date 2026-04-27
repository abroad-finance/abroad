import { useCallback, useEffect, useRef } from 'react'

import { useNotices } from '../../contexts/NoticeContext'

const DEFAULT_INTERVAL_MS = 60_000

interface UseVersionCheckOptions {
  currentView?: string
  pollingIntervalMs?: number
  suppressWhileViews?: string[]
}

export function useVersionCheck({ currentView, pollingIntervalMs = DEFAULT_INTERVAL_MS, suppressWhileViews = [] }: UseVersionCheckOptions = {}): void {
  const { addNotice } = useNotices()
  const knownVersionRef = useRef<null | string>(null)
  const updateDetectedRef = useRef(false)
  const noticeShownRef = useRef(false)

  const showReloadNotice = useCallback(() => {
    if (noticeShownRef.current) return
    noticeShownRef.current = true
    addNotice({
      actionLabel: 'Reload',
      description: 'Tap reload to get the latest version.',
      kind: 'info',
      message: 'A new version is available',
      onAction: () => window.location.reload(),
    })
  }, [addNotice])

  // Poll for version changes
  useEffect(() => {
    if (noticeShownRef.current) return

    const check = async () => {
      const remote = await fetchRemoteVersion()
      if (!remote) return
      if (!knownVersionRef.current) {
        knownVersionRef.current = remote
        return
      }
      if (remote !== knownVersionRef.current) {
        updateDetectedRef.current = true
      }
    }

    void check()
    const id = setInterval(() => void check(), pollingIntervalMs)
    return () => clearInterval(id)
  }, [pollingIntervalMs])

  // Show notice when update detected and view is not suppressed
  useEffect(() => {
    if (!updateDetectedRef.current || noticeShownRef.current) return
    const isSuppressed = currentView != null && suppressWhileViews.includes(currentView)
    if (!isSuppressed) {
      showReloadNotice()
    }
  }, [
    currentView,
    showReloadNotice,
    suppressWhileViews,
  ])
}

async function fetchRemoteVersion(): Promise<null | string> {
  try {
    const response = await fetch(`/version.json?t=${Date.now()}`)
    if (!response.ok) return null
    const data = await response.json()
    return typeof data?.version === 'string' ? data.version : null
  }
  catch {
    return null
  }
}
