import {
  CircleUserRound,
  ExternalLink,
  History,
  LogOut,
  Menu,
  Moon,
  Sun,
} from 'lucide-react'
import React, {
  memo,
  useEffect,
  useRef,
  useState,
} from 'react'

import AbroadLogoColored from '@/assets/Logos/AbroadLogoColored.svg'
import AbroadLogoWhite from '@/assets/Logos/AbroadLogoWhite.svg'
import { AB_STYLES } from '@/shared/constants'
import { cn } from '@/shared/utils'

export interface NavBarResponsiveProps {
  address?: null | string
  className?: string
  hideWalletButton?: boolean
  infoUrl: string
  isDark?: boolean
  labels: {
    connected?: string
    connectWallet: string
    connectWalletAria: string
    disconnectAria?: string
    disconnectFailed?: string
    disconnectTitle?: string
    history?: string
    infoAriaLabel: string
    language?: string
    notConnected: string
    useDarkTheme?: string
    useLightTheme?: string
    utilities?: string
  }
  languageSelector?: React.ReactNode
  onDisconnect?: () => Promise<void>
  onHeaderAction?: (action: 'close' | 'help' | 'open' | 'switch' | 'view_activity') => void
  onHistoryClick?: () => void
  onToggleTheme?: () => void
  walletInfo: {
    icon?: string
    name: string
  }
}

const MENU_ITEM_CLASS = 'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold transition-colors hover:bg-[var(--ab-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)]'

const NavBarResponsive = ({
  address,
  className = '',
  hideWalletButton = false,
  infoUrl,
  isDark = false,
  labels,
  languageSelector,
  onDisconnect,
  onHeaderAction,
  onHistoryClick,
  onToggleTheme,
  walletInfo,
}: Readonly<NavBarResponsiveProps>): React.JSX.Element => {
  const [utilitiesOpen, setUtilitiesOpen] = useState(false)
  const [utilityError, setUtilityError] = useState<null | string>(null)
  const menuContainerRef = useRef<HTMLDivElement>(null)
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const isConnected = Boolean(address)
  const compactAddress = address && address.length > 10
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : address

  useEffect(() => {
    if (!utilitiesOpen) return

    const closeOnOutsidePointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Node
        && !menuContainerRef.current?.contains(event.target)
      ) {
        setUtilitiesOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setUtilitiesOpen(false)
      menuTriggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [utilitiesOpen])

  const openInfo = (): void => {
    onHeaderAction?.('help')
    window.open(infoUrl, '_blank', 'noopener,noreferrer')
    setUtilitiesOpen(false)
  }

  const toggleTheme = (): void => {
    onHeaderAction?.('switch')
    onToggleTheme?.()
    setUtilitiesOpen(false)
  }

  return (
    <nav
      className={cn(
        'ab-nav sticky top-0 z-[100] w-full border-b px-3 py-2 backdrop-blur-[6px] sm:px-5',
        className,
      )}
      role="navigation"
    >
      <div className="mx-auto flex min-h-12 w-full items-center justify-between gap-2">
        <img
          alt="Abroad"
          className="h-6 w-auto shrink-0 sm:h-7"
          src={isDark ? AbroadLogoWhite : AbroadLogoColored}
        />

        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          {isConnected && onHistoryClick && (
            <button
              aria-label={labels.history ?? 'Activity'}
              className={cn(
                'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl px-2.5 text-sm font-semibold transition-colors hover:bg-[var(--ab-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)] sm:px-3',
                AB_STYLES.textSecondary,
              )}
              onClick={() => {
                onHeaderAction?.('view_activity')
                onHistoryClick()
              }}
              type="button"
            >
              <History aria-hidden="true" className="h-4.5 w-4.5" />
              <span className="hidden sm:inline">{labels.history ?? 'Activity'}</span>
            </button>
          )}

          {isConnected && !hideWalletButton && (
            <div
              aria-label={`${labels.connected ?? 'Connected'}: ${walletInfo.name}${compactAddress ? `, ${compactAddress}` : ''}`}
              className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] px-2.5 text-xs font-semibold text-[var(--ab-text-secondary)] sm:px-3"
              role="status"
              title={address ?? undefined}
            >
              <CircleUserRound aria-hidden="true" className="h-4.5 w-4.5 shrink-0 text-[var(--ab-green)]" />
              <span className="hidden max-w-28 truncate md:inline">{walletInfo.name}</span>
              {compactAddress && <span className="hidden font-mono lg:inline">{compactAddress}</span>}
            </div>
          )}

          {!isConnected && !hideWalletButton && (
            <div
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--ab-border)] bg-[var(--ab-bg-subtle)] px-3 text-xs font-semibold text-[var(--ab-text-secondary)]"
              role="status"
            >
              <CircleUserRound aria-hidden="true" className="h-4.5 w-4.5" />
              <span className="hidden sm:inline">{labels.notConnected}</span>
            </div>
          )}

          <div className="relative" ref={menuContainerRef}>
            <button
              aria-expanded={utilitiesOpen}
              aria-haspopup="menu"
              aria-label={labels.utilities ?? 'Language, help, and account options'}
              className={cn(
                'inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl transition-colors hover:bg-[var(--ab-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)]',
                AB_STYLES.textSecondary,
              )}
              onClick={() => setUtilitiesOpen((current) => {
                onHeaderAction?.(current ? 'close' : 'open')
                return !current
              })}
              ref={menuTriggerRef}
              type="button"
            >
              <Menu aria-hidden="true" className="h-5 w-5" />
            </button>

            {utilitiesOpen && (
              <div
                aria-label={labels.utilities ?? 'Language, help, and account options'}
                className="absolute right-0 top-[calc(100%+0.5rem)] z-[200] w-72 rounded-2xl border border-[var(--ab-border)] bg-[var(--ab-card)] p-2 shadow-xl"
                role="menu"
              >
                {languageSelector && (
                  <div className="rounded-xl px-2 py-2" role="none">
                    <p className="mb-1 text-xs font-bold uppercase tracking-wider text-[var(--ab-text-muted)]">{labels.language ?? 'Language'}</p>
                    {languageSelector}
                  </div>
                )}
                {onToggleTheme && (
                  <button className={cn(MENU_ITEM_CLASS, AB_STYLES.textSecondary)} onClick={toggleTheme} role="menuitem" type="button">
                    {isDark ? <Sun aria-hidden="true" className="h-4.5 w-4.5" /> : <Moon aria-hidden="true" className="h-4.5 w-4.5" />}
                    {isDark ? (labels.useLightTheme ?? 'Use light theme') : (labels.useDarkTheme ?? 'Use dark theme')}
                  </button>
                )}
                <button className={cn(MENU_ITEM_CLASS, AB_STYLES.textSecondary)} onClick={openInfo} role="menuitem" type="button">
                  <ExternalLink aria-hidden="true" className="h-4.5 w-4.5" />
                  {labels.infoAriaLabel}
                </button>
                {address && !hideWalletButton && onDisconnect && (
                  <button
                    className={cn(MENU_ITEM_CLASS, 'text-red-700')}
                    onClick={() => {
                      setUtilityError(null)
                      setUtilitiesOpen(false)
                      void onDisconnect().catch(() => {
                        setUtilityError(labels.disconnectFailed ?? 'Could not disconnect the wallet. Please try again.')
                        setUtilitiesOpen(true)
                      })
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <LogOut aria-hidden="true" className="h-4.5 w-4.5" />
                    {labels.disconnectTitle ?? labels.disconnectAria ?? 'Disconnect wallet'}
                  </button>
                )}
                {utilityError && <p className="px-3 py-2 text-sm text-red-700" role="alert">{utilityError}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}

export default memo(NavBarResponsive)
