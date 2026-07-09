import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import { getTransaction } from '../../services/admin/transactionAdminApi'
import { OpsTransactionDetail } from '../../services/admin/transactionAdminTypes'
import {
  formatDateTime,
  humanizeStatus,
  OpsLoading,
  OpsPageShell,
} from './shared'

const Field = ({ label, value }: { label: string, value: null | number | string }) => (
  <div>
    <div className="text-xs uppercase tracking-wider text-ops-label">{label}</div>
    <div className="mt-1 break-all text-sm font-medium">{value === null || value === '' ? '—' : value}</div>
  </div>
)

const TransactionDetail = () => {
  const { transactionId } = useParams()
  const [data, setData] = useState<null | OpsTransactionDetail>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<null | string>(null)
  const opsApiKey = useOpsApiKey()

  const load = useCallback(async () => {
    if (!transactionId || !opsApiKey) {
      setData(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)

    try {
      const result = await getTransaction(transactionId)
      setData(result)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transaction')
    }
    finally {
      setLoading(false)
    }
  }, [opsApiKey, transactionId])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <OpsPageShell
      actions={data?.flowInstanceId
        ? (
            <Link className="ops-btn-ghost" to={`/ops/flows/${data.flowInstanceId}`}>
              View flow
            </Link>
          )
        : undefined}
      backLink={{ label: 'Back to transactions', to: '/ops/transactions' }}
      error={error}
      eyebrow="Transaction"
      keyRequiredMessage="Ops API key required to load the transaction."
      title={<span className="break-all">{transactionId}</span>}
      width="narrow"
    >
      {loading && opsApiKey && (
        <OpsLoading label="Loading transaction…" />
      )}

      {data && opsApiKey && (
        <div className="mt-8 space-y-6">
          <div className="ops-card p-6">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              <Field label="Status" value={humanizeStatus(data.status)} />
              <Field label="Created" value={formatDateTime(data.createdAt)} />
              <Field label="Exchange handoff" value={formatDateTime(data.exchangeHandoffAt)} />
              <Field label="Partner" value={data.partnerId} />
              <Field label="User" value={data.userId} />
              <Field label="External ID" value={data.externalId} />
              <Field label="On-chain ID" value={data.onChainId} />
              <Field label="Refund on-chain" value={data.refundOnChainId} />
              <Field label="Flow instance" value={data.flowInstanceId} />
            </div>
          </div>

          <div className="ops-card p-6">
            <h2 className="text-lg font-semibold">Quote</h2>
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
              <Field label="Source amount" value={`${data.quote.sourceAmount} ${data.quote.cryptoCurrency}`} />
              <Field label="Target amount" value={`${data.quote.targetAmount} ${data.quote.targetCurrency}`} />
              <Field label="Network" value={data.quote.network} />
              <Field label="Payment method" value={data.quote.paymentMethod} />
              <Field label="Country" value={data.quote.country} />
            </div>
          </div>

          <div className="ops-card p-6">
            <h2 className="text-lg font-semibold">Payout</h2>
            <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
              <Field label="Account number" value={data.accountNumber} />
              <Field label="Bank code" value={data.bankCode} />
              <Field label="Tax ID" value={data.taxId} />
            </div>
          </div>
        </div>
      )}
    </OpsPageShell>
  )
}

export default TransactionDetail
