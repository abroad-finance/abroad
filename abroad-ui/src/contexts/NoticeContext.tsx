import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
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

export const NoticeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notices, setNotices] = useState<Notice[]>([])

  const addNotice = useCallback((notice: Omit<Notice, 'id'>) => {
    const id = buildId()
    setNotices(prev => [...prev, { ...notice, id }])
    return id
  }, [])

  const removeNotice = useCallback((id: string) => {
    setNotices(prev => prev.filter(n => n.id !== id))
  }, [])

  const clearNotices = useCallback(() => setNotices([]), [])

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
