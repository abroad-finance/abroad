import React from 'react'

import { cn } from '@/shared/utils'

import type { ActivityStatusTone } from '../shared/activityPresentation'

const toneClasses: Record<ActivityStatusTone, string> = {
  'awaiting': 'border-amber-200 bg-amber-50 text-amber-800',
  'completed': 'border-emerald-200 bg-emerald-50 text-emerald-800',
  'expired': 'border-slate-300 bg-slate-100 text-slate-700',
  'failed': 'border-red-200 bg-red-50 text-red-800',
  'processing': 'border-blue-200 bg-blue-50 text-blue-800',
  'unknown': 'border-violet-200 bg-violet-50 text-violet-800',
  'wrong-amount': 'border-orange-200 bg-orange-50 text-orange-800',
}

type ActivityStatusPillProps = {
  label: string
  tone: ActivityStatusTone
}

export const ActivityStatusPill = ({ label, tone }: Readonly<ActivityStatusPillProps>): React.JSX.Element => (
  <span className={cn('inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-xs font-bold', toneClasses[tone])}>
    {label}
  </span>
)
