import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { Notice } from '../shared/types/notice'

import { NoticeCenter } from '../shared/components/NoticeCenter'

interface NoticeContextValue {
  addNotice: (notice: Omit<Notice, 'id'>) => string
  clearNotices: () => void
  removeNotice: (id: string) => void
}

const NoticeContext = createContext<NoticeContextValue>({
  addNotice: () => '',
  clearNotices: () => { },
  removeNotice: () => { },
})

const buildId = () => crypto.randomUUID?.() || `notice-${Date.now()}-${Math.random().toString(16).slice(2)}`
const ERROR_AUTO_DISMISS_MS = 5_000

export const NoticeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notices, setNotices] = useState<Notice[]>([])
  const timeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const removeNotice = useCallback((id: string) => {
    const timeoutId = timeoutsRef.current.get(id)
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutsRef.current.delete(id)
    }
    setNotices(prev => prev.filter(n => n.id !== id))
  }, [])

  const addNotice = useCallback((notice: Omit<Notice, 'id'>) => {
    const id = buildId()
    setNotices(prev => [...prev, { ...notice, id }])
    if (notice.kind === 'error') {
      const timeoutId = setTimeout(() => {
        removeNotice(id)
      }, ERROR_AUTO_DISMISS_MS)
      timeoutsRef.current.set(id, timeoutId)
    }
    return id
  }, [removeNotice])

  const clearNotices = useCallback(() => {
    timeoutsRef.current.forEach(timeoutId => clearTimeout(timeoutId))
    timeoutsRef.current.clear()
    setNotices([])
  }, [])

  useEffect(() => () => {
    timeoutsRef.current.forEach(timeoutId => clearTimeout(timeoutId))
    timeoutsRef.current.clear()
  }, [])

  const value = useMemo<NoticeContextValue>(() => ({
    addNotice,
    clearNotices,
    removeNotice,
  }), [
    addNotice,
    clearNotices,
    removeNotice,
  ])

  return (
    <NoticeContext.Provider value={value}>
      <NoticeCenter notices={notices} onDismiss={removeNotice} />
      {children}
    </NoticeContext.Provider>
  )
}

export const useNotices = () => useContext(NoticeContext)
