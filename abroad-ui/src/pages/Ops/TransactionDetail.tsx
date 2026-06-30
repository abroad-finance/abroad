import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useOpsApiKey } from '../../services/admin/opsAuthStore'
import { getTransaction } from '../../services/admin/transactionAdminApi'
import { OpsTransactionDetail } from '../../services/admin/transactionAdminTypes'
import OpsApiKeyPanel from './OpsApiKeyPanel'

const formatDate = (value: null | string) => (value ? new Date(value).toLocaleString() : '—')

const Field = ({ label, value }: { label: string, value: null | number | string }) => (
  <div>
    <div className="text-xs uppercase tracking-wider text-gray-500">{label}</div>
    <div className="mt-1 text-sm font-medium break-all">{value === null || value === '' ? '—' : value}</div>
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
    <div className="ops-page">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(27,94,89,0.18),_transparent_55%)]" />
        <div className="relative max-w-5xl mx-auto px-6 py-10">
          <div className="flex items-center gap-3 text-sm">
            <Link className="text-ops-brand hover:text-abroad-dark" to="/ops/transactions">← Back to transactions</Link>
            {data?.flowInstanceId && (
              <Link className="text-ops-brand hover:text-abroad-dark" to={`/ops/flows/${data.flowInstanceId}`}>
                View flow
              </Link>
            )}
          </div>
          <div className="mt-3 text-sm uppercase tracking-[0.3em] text-abroad-dark">Transaction</div>
          <h1 className="text-2xl md:text-3xl font-semibold break-all">{transactionId}</h1>

          <OpsApiKeyPanel />

          {error && (
            <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}
          {!opsApiKey && (
            <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Ops API key required to load the transaction.
            </div>
          )}
          {loading && opsApiKey && (
            <div className="mt-6 text-sm text-gray-500">Loading transaction...</div>
          )}

          {data && opsApiKey && (
            <div className="mt-8 space-y-6">
              <div className="rounded-2xl border border-white/70 bg-white/80 p-6 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <Field label="Status" value={data.status} />
                  <Field label="Created" value={formatDate(data.createdAt)} />
                  <Field label="Exchange handoff" value={formatDate(data.exchangeHandoffAt)} />
                  <Field label="Partner" value={data.partnerId} />
                  <Field label="User" value={data.userId} />
                  <Field label="External ID" value={data.externalId} />
                  <Field label="On-chain ID" value={data.onChainId} />
                  <Field label="Refund on-chain" value={data.refundOnChainId} />
                  <Field label="Flow instance" value={data.flowInstanceId} />
                </div>
              </div>

              <div className="rounded-2xl border border-white/70 bg-white/80 p-6 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
                <h2 className="text-lg font-semibold">Quote</h2>
                <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
                  <Field label="Source amount" value={`${data.quote.sourceAmount} ${data.quote.cryptoCurrency}`} />
                  <Field label="Target amount" value={`${data.quote.targetAmount} ${data.quote.targetCurrency}`} />
                  <Field label="Network" value={data.quote.network} />
                  <Field label="Payment method" value={data.quote.paymentMethod} />
                  <Field label="Country" value={data.quote.country} />
                </div>
              </div>

              <div className="rounded-2xl border border-white/70 bg-white/80 p-6 shadow-[0_20px_45px_-35px_rgba(15,23,42,0.45)]">
                <h2 className="text-lg font-semibold">Payout</h2>
                <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
                  <Field label="Account number" value={data.accountNumber} />
                  <Field label="Bank code" value={data.bankCode} />
                  <Field label="Tax ID" value={data.taxId} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TransactionDetail
