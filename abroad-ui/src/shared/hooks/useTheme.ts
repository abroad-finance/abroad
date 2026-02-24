import { useCallback, useEffect, useState } from 'react'

type Theme = 'dark' | 'light' | 'system'
const STORAGE_KEY = 'abroad:theme'

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light'
    return (localStorage.getItem(STORAGE_KEY) as Theme) || 'light'
  })

  const isDark = resolveTheme(theme) === 'dark'

  useEffect(() => {
    applyTheme(resolveTheme(theme))
  }, [theme])

  // Listen for system preference changes when theme is 'system'
  useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme(getSystemPreference())
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
    // Fallback for older Safari
    mq.addListener(handler)
    return () => mq.removeListener(handler)
  }, [theme])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    localStorage.setItem(STORAGE_KEY, t)
  }, [])

  const toggleTheme = useCallback(() => {
    const next = isDark ? 'light' : 'dark'
    setTheme(next)
  }, [isDark, setTheme])

  return {
    isDark, setTheme, theme, toggleTheme,
  }
}

function applyTheme(resolved: 'dark' | 'light') {
  const root = document.documentElement
  if (resolved === 'dark') {
    root.classList.add('dark')
  }
  else {
    root.classList.remove('dark')
  }
}

function getSystemPreference(): 'dark' | 'light' {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(theme: Theme): 'dark' | 'light' {
  return theme === 'system' ? getSystemPreference() : theme
}
