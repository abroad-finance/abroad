/* eslint-disable react-refresh/only-export-components -- the provider and its typed consumer hook are one state boundary. */
import type { ReactNode } from 'react'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { getOpsIncidentOverview } from '../../../services/admin/incidentAdminApi'
import { useOpsAuth } from '../../../services/admin/opsAuthStore'

type OpsShellDataState = 'FRESH' | 'LOADING' | 'STALE' | 'UNAVAILABLE' | 'UNKNOWN'

type OpsShellStatus = {
  checkedAt: null | string
  dataState: OpsShellDataState
  incidentCount: null | number
  refresh: () => Promise<void>
  unownedIncidentCount: null | number
}

const EMPTY_STATUS: OpsShellStatus = {
  checkedAt: null,
  dataState: 'UNKNOWN',
  incidentCount: null,
  refresh: async () => undefined,
  unownedIncidentCount: null,
}

const OpsShellStatusContext = createContext<OpsShellStatus>(EMPTY_STATUS)

const POLL_INTERVAL_MS = 60_000
const STALE_AFTER_MS = 2 * POLL_INTERVAL_MS

export const OpsShellStatusProvider = ({ children }: { children: ReactNode }) => {
  const auth = useOpsAuth()
  const [checkedAt, setCheckedAt] = useState<null | string>(null)
  const [dataState, setDataState] = useState<OpsShellDataState>('UNKNOWN')
  const [incidentCount, setIncidentCount] = useState<null | number>(null)
  const [unownedIncidentCount, setUnownedIncidentCount] = useState<null | number>(null)
  const hasIncidentDataRef = useRef(false)

  const isAuthenticated = Boolean(auth.session || auth.legacyApiKey)

  const refresh = useCallback(async (): Promise<void> => {
    if (!isAuthenticated) return
    setDataState(current => current === 'UNKNOWN' ? 'LOADING' : current)
    try {
      const overview = await getOpsIncidentOverview()
      setCheckedAt(new Date().toISOString())
      setDataState('FRESH')
      setIncidentCount(overview.open)
      setUnownedIncidentCount(overview.unowned)
      hasIncidentDataRef.current = true
    }
    catch {
      setDataState(hasIncidentDataRef.current ? 'STALE' : 'UNAVAILABLE')
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated) {
      setCheckedAt(null)
      setDataState('UNKNOWN')
      setIncidentCount(null)
      setUnownedIncidentCount(null)
      hasIncidentDataRef.current = false
      return
    }
    void refresh()
    const poll = window.setInterval(() => void refresh(), POLL_INTERVAL_MS)
    const staleCheck = window.setInterval(() => {
      setCheckedAt((current) => {
        if (current && Date.now() - Date.parse(current) > STALE_AFTER_MS) setDataState('STALE')
        return current
      })
    }, POLL_INTERVAL_MS)
    return () => {
      window.clearInterval(poll)
      window.clearInterval(staleCheck)
    }
  }, [isAuthenticated, refresh])

  const value = useMemo<OpsShellStatus>(() => ({
    checkedAt,
    dataState,
    incidentCount,
    refresh,
    unownedIncidentCount,
  }), [
    checkedAt,
    dataState,
    incidentCount,
    refresh,
    unownedIncidentCount,
  ])

  return <OpsShellStatusContext.Provider value={value}>{children}</OpsShellStatusContext.Provider>
}

export const useOpsShellStatus = (): OpsShellStatus => useContext(OpsShellStatusContext)
