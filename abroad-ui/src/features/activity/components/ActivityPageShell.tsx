import { useTranslate } from '@tolgee/react'
import React from 'react'
import { Link } from 'react-router-dom'

import AbroadLogoColored from '@/assets/Logos/AbroadLogoColored.svg'

type ActivityPageShellProps = {
  children: React.ReactNode
}

export const ActivityPageShell = ({ children }: Readonly<ActivityPageShellProps>): React.JSX.Element => {
  const { t } = useTranslate()
  return (
    <div className="min-h-dvh bg-[var(--ab-bg)] text-[var(--ab-text)]">
      <header className="sticky top-0 z-30 border-b border-[var(--ab-border)] bg-[var(--ab-bg)]/95 backdrop-blur-md">
        <div className="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 py-2 sm:px-6">
          <Link
            aria-label={t('activity.navigation.home', 'Abroad home')}
            className="flex min-h-11 items-center rounded-xl px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)]"
            to="/"
          >
            <img alt="Abroad" className="h-7 w-auto" src={AbroadLogoColored} />
          </Link>
          <nav aria-label={t('activity.navigation.label', 'Activity navigation')} className="flex items-center gap-2">
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--ab-border)] bg-[var(--ab-card)] px-4 text-sm font-semibold text-[var(--ab-text-secondary)] transition-colors hover:bg-[var(--ab-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ab-green)]"
              to="/"
            >
              {t('activity.navigation.new_payment', 'New payment')}
            </Link>
          </nav>
        </div>
      </header>
      {children}
    </div>
  )
}
