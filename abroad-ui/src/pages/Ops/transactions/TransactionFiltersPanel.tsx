import type { FormEvent } from 'react'

import { Filter, RotateCcw } from 'lucide-react'

import type { OpsCaseUser } from '../../../services/admin/transactionAdminTypes'

import {
  opsAttentionFilters,
  opsProofStatuses,
  opsRefundStatuses,
  opsWebhookStatuses,
  transactionStatuses,
} from '../../../services/admin/transactionAdminTypes'
import { humanizeStatus, OpsField } from '../shared'
import { TransactionFilterDraft } from './transactionFilterState'

type Props = {
  applied: TransactionFilterDraft
  draft: TransactionFilterDraft
  loading: boolean
  onApply: () => void
  onChange: (next: TransactionFilterDraft) => void
  onReset: () => void
  owners: OpsCaseUser[]
}

const setField = <TKey extends keyof TransactionFilterDraft>(
  draft: TransactionFilterDraft,
  key: TKey,
  value: TransactionFilterDraft[TKey],
): TransactionFilterDraft => ({ ...draft, [key]: value })

const TransactionFiltersPanel = ({
  applied,
  draft,
  loading,
  onApply,
  onChange,
  onReset,
  owners,
}: Props) => {
  const dirty = JSON.stringify(applied) !== JSON.stringify(draft)
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    onApply()
  }

  return (
    <form className="ops-card mt-6 overflow-hidden" onSubmit={submit}>
      <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,2fr)_minmax(13rem,0.8fr)_auto] md:items-end md:p-5">
        <OpsField hint="Transaction, quote, chain, PIX E2E, refund, provider, flow, partner, or partner-user reference." label="Search operational identifiers">
          <input
            autoComplete="off"
            className="ops-input"
            maxLength={200}
            name="transaction-query"
            onChange={event => onChange(setField(draft, 'query', event.target.value))}
            placeholder="Paste an identifier or partner name"
            value={draft.query}
          />
        </OpsField>
        <OpsField label="Transaction status">
          <select
            className="ops-input"
            name="transaction-status"
            onChange={event => onChange(setField(draft, 'status', event.target.value as TransactionFilterDraft['status']))}
            value={draft.status}
          >
            <option value="">All statuses</option>
            {transactionStatuses.map(status => <option key={status} value={status}>{humanizeStatus(status)}</option>)}
          </select>
        </OpsField>
        <button className="ops-btn-primary min-h-11" disabled={loading || !dirty} type="submit">
          <Filter aria-hidden size={17} />
          {loading ? 'Loading…' : dirty ? 'Apply filters' : 'Filters applied'}
        </button>
      </div>

      <details className="border-t border-ops-border">
        <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-ops-text marker:hidden hover:bg-ops-bg md:px-5">
          <span>Advanced investigation filters</span>
          <span className="text-xs font-normal text-ops-muted">Date · partner · route · proof · case</span>
        </summary>
        <div className="grid gap-4 border-t border-ops-border bg-ops-bg/55 p-4 sm:grid-cols-2 lg:grid-cols-4 md:p-5">
          <OpsField label="Needs attention">
            <select
              className="ops-input"
              name="transaction-attention"
              onChange={event => onChange(setField(draft, 'attention', event.target.value as TransactionFilterDraft['attention']))}
              value={draft.attention}
            >
              <option value="">Any posture</option>
              {opsAttentionFilters.map(value => <option key={value} value={value}>{humanizeStatus(value)}</option>)}
            </select>
          </OpsField>
          <OpsField label="Created from">
            <input className="ops-input" name="transaction-created-from" onChange={event => onChange(setField(draft, 'createdFrom', event.target.value))} type="date" value={draft.createdFrom} />
          </OpsField>
          <OpsField label="Created to">
            <input className="ops-input" name="transaction-created-to" onChange={event => onChange(setField(draft, 'createdTo', event.target.value))} type="date" value={draft.createdTo} />
          </OpsField>
          <OpsField label="Partner ID">
            <input autoComplete="off" className="ops-input" name="transaction-partner" onChange={event => onChange(setField(draft, 'partnerId', event.target.value))} placeholder="Partner UUID" value={draft.partnerId} />
          </OpsField>
          <OpsField label="Direction">
            <select className="ops-input" name="transaction-direction" onChange={event => onChange(setField(draft, 'direction', event.target.value as TransactionFilterDraft['direction']))} value={draft.direction}>
              <option value="">Both directions</option>
              <option value="CRYPTO_TO_FIAT">Payout (crypto → fiat)</option>
              <option value="FIAT_TO_CRYPTO">Onramp (fiat → crypto)</option>
            </select>
          </OpsField>
          <OpsField label="Fiat rail">
            <select className="ops-input" name="transaction-provider" onChange={event => onChange(setField(draft, 'paymentMethod', event.target.value as TransactionFilterDraft['paymentMethod']))} value={draft.paymentMethod}>
              <option value="">All providers</option>
              <option value="PIX">Transfero Ultra (PIX)</option>
              <option value="BREB">Bre-B</option>
              <option value="NEQUI">Nequi (legacy)</option>
              <option value="MOVII">Movii (legacy)</option>
            </select>
          </OpsField>
          <OpsField label="Crypto asset">
            <select className="ops-input" name="transaction-asset" onChange={event => onChange(setField(draft, 'cryptoCurrency', event.target.value as TransactionFilterDraft['cryptoCurrency']))} value={draft.cryptoCurrency}>
              <option value="">Any asset</option>
              <option value="USDC">USDC</option>
              <option value="USDT">USDT</option>
            </select>
          </OpsField>
          <OpsField label="Crypto network">
            <select className="ops-input" name="transaction-network" onChange={event => onChange(setField(draft, 'network', event.target.value as TransactionFilterDraft['network']))} value={draft.network}>
              <option value="">Any network</option>
              <option value="STELLAR">Stellar</option>
              <option value="SOLANA">Solana</option>
              <option value="CELO">Celo</option>
            </select>
          </OpsField>
          <OpsField label="Target currency">
            <select className="ops-input" name="transaction-currency" onChange={event => onChange(setField(draft, 'targetCurrency', event.target.value as TransactionFilterDraft['targetCurrency']))} value={draft.targetCurrency}>
              <option value="">Any currency</option>
              <option value="BRL">BRL</option>
              <option value="COP">COP</option>
            </select>
          </OpsField>
          <OpsField label="Proof state">
            <select className="ops-input" name="transaction-proof" onChange={event => onChange(setField(draft, 'proofStatus', event.target.value as TransactionFilterDraft['proofStatus']))} value={draft.proofStatus}>
              <option value="">Any proof state</option>
              {opsProofStatuses.map(value => <option key={value} value={value}>{humanizeStatus(value)}</option>)}
            </select>
          </OpsField>
          <OpsField label="Refund state">
            <select className="ops-input" name="transaction-refund" onChange={event => onChange(setField(draft, 'refundStatus', event.target.value as TransactionFilterDraft['refundStatus']))} value={draft.refundStatus}>
              <option value="">Any refund state</option>
              {opsRefundStatuses.map(value => <option key={value} value={value}>{humanizeStatus(value)}</option>)}
            </select>
          </OpsField>
          <OpsField label="Webhook state">
            <select className="ops-input" name="transaction-webhook" onChange={event => onChange(setField(draft, 'webhookStatus', event.target.value as TransactionFilterDraft['webhookStatus']))} value={draft.webhookStatus}>
              <option value="">Any webhook state</option>
              {opsWebhookStatuses.map(value => <option key={value} value={value}>{humanizeStatus(value)}</option>)}
            </select>
          </OpsField>
          <OpsField label="Case state">
            <select className="ops-input" name="transaction-case-status" onChange={event => onChange(setField(draft, 'caseStatus', event.target.value as TransactionFilterDraft['caseStatus']))} value={draft.caseStatus}>
              <option value="">Any case state</option>
              <option value="OPEN">Open</option>
              <option value="ACKNOWLEDGED">Acknowledged</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </OpsField>
          <OpsField label="Case owner">
            <select className="ops-input" name="transaction-case-owner" onChange={event => onChange(setField(draft, 'caseOwnerId', event.target.value))} value={draft.caseOwnerId}>
              <option value="">Any owner</option>
              {owners.map(owner => <option key={owner.id} value={owner.id}>{owner.displayName}</option>)}
            </select>
          </OpsField>
          <div className="flex items-end lg:col-start-4">
            <button className="ops-btn-neutral min-h-11 w-full" onClick={onReset} type="button">
              <RotateCcw aria-hidden size={16} />
              Clear all filters
            </button>
          </div>
        </div>
      </details>
    </form>
  )
}

export default TransactionFiltersPanel
