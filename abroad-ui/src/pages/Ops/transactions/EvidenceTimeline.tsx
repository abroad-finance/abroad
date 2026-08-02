import {
  BadgeDollarSign,
  Blocks,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDot,
  FileCheck2,
  GitBranch,
  RadioTower,
  RotateCcw,
  Send,
} from 'lucide-react'

import type { OpsEvidenceEvent } from '../../../services/admin/transactionAdminTypes'

import { formatDateTime } from '../shared'

const categoryIcon: Readonly<Record<OpsEvidenceEvent['category'], React.ReactNode>> = {
  CASE: <BriefcaseBusiness aria-hidden size={16} />,
  CHAIN: <Blocks aria-hidden size={16} />,
  FLOW: <GitBranch aria-hidden size={16} />,
  PROOF: <FileCheck2 aria-hidden size={16} />,
  PROVIDER: <Send aria-hidden size={16} />,
  QUOTE: <BadgeDollarSign aria-hidden size={16} />,
  REFUND: <RotateCcw aria-hidden size={16} />,
  TRANSACTION: <CircleDot aria-hidden size={16} />,
  WEBHOOK: <RadioTower aria-hidden size={16} />,
}

const stateClass: Readonly<Record<OpsEvidenceEvent['state'], string>> = {
  FAILED: 'border-rose-200 bg-rose-50 text-rose-700',
  INFO: 'border-slate-200 bg-slate-50 text-slate-600',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
  SUCCEEDED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  WARNING: 'border-orange-200 bg-orange-50 text-orange-700',
}

const EvidenceTimeline = ({ events }: { events: OpsEvidenceEvent[] }) => (
  <section aria-labelledby="evidence-timeline-title" className="ops-card p-5 sm:p-6">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="ops-eyebrow">Canonical evidence</p>
        <h2 className="mt-1 text-xl font-semibold text-ops-text" id="evidence-timeline-title">End-to-end timeline</h2>
        <p className="mt-1 text-sm text-ops-muted">Quote, chain, transaction, flow, provider, webhook, proof, refund, and case events in one order.</p>
      </div>
      <span className="rounded-full border border-ops-border bg-white px-2.5 py-1 text-xs font-semibold text-ops-muted">
        {events.length}
        {' '}
        events
      </span>
    </div>

    <ol className="relative mt-6 space-y-0 before:absolute before:bottom-4 before:left-[17px] before:top-4 before:w-px before:bg-ops-border">
      {events.map(event => (
        <li className="relative grid grid-cols-[2.25rem_minmax(0,1fr)] gap-3 pb-6 last:pb-0" key={event.id}>
          <span className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full border ${stateClass[event.state]}`}>
            {event.state === 'SUCCEEDED' ? <CheckCircle2 aria-hidden size={16} /> : categoryIcon[event.category]}
          </span>
          <div className="min-w-0 pt-0.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="text-sm font-semibold text-ops-text">{event.title}</h3>
              <time className="text-xs text-ops-muted" dateTime={event.occurredAt}>{formatDateTime(event.occurredAt)}</time>
            </div>
            <p className="mt-1 text-sm leading-6 text-ops-muted">{event.description}</p>
            <span className="mt-1.5 inline-block text-[10px] font-semibold uppercase tracking-wider text-ops-label">{event.category}</span>
          </div>
        </li>
      ))}
    </ol>
  </section>
)

export default EvidenceTimeline
