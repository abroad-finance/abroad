import { ExternalLink, UserRoundSearch } from 'lucide-react'
import { Link } from 'react-router-dom'

import type { OpsKycStatus, OpsKycSummary, OpsKycTransactionLink } from '../../../services/admin/kycAdminTypes'

import { kycSubmissionPath } from '../kyc/kycLinks'
import {
  formatDateTime,
  humanizeStatus,
  OpsBanner,
  OpsStatusBadge,
  OpsTone,
} from '../shared'

type CustomerIdentityPanelProps = {
  /** Null while the identity is still loading or the role cannot read KYC. */
  identity: null | OpsKycTransactionLink
  loadError: null | string
  permitted: boolean
}

const statusTone: Readonly<Record<OpsKycStatus, OpsTone>> = {
  APPROVED: 'success',
  PENDING: 'warning',
  PENDING_APPROVAL: 'info',
  REJECTED: 'danger',
}

const SubmissionRow = ({ effective, submission }: {
  effective: boolean
  submission: OpsKycSummary
}) => (
  <li className="rounded-xl border border-ops-border bg-ops-bg/60 p-3">
    <div className="flex flex-wrap items-center gap-2">
      <OpsStatusBadge label={humanizeStatus(submission.status)} tone={statusTone[submission.status]} />
      {effective && <OpsStatusBadge tone="info">On file at payment</OpsStatusBadge>}
    </div>
    <p className="mt-2 break-words text-sm font-semibold text-ops-text">
      {submission.fullNameMasked ?? 'Masked identity'}
    </p>
    <p className="mt-1 text-xs text-ops-muted">
      {submission.documentNumberMasked ?? 'Document masked'}
      {' · '}
      Submitted
      {' '}
      {formatDateTime(submission.submittedAt)}
    </p>
    <Link
      className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ops-brand"
      to={kycSubmissionPath(submission.id)}
    >
      View KYC record
      <ExternalLink aria-hidden size={15} />
    </Link>
  </li>
)

/**
 * Names the customer behind a transaction and links straight to their KYC.
 * Everything here is masked exactly as the review queue is; reading the actual
 * identity evidence stays the separate, audited reveal on the KYC page.
 */
const CustomerIdentityPanel = ({ identity, loadError, permitted }: CustomerIdentityPanelProps) => (
  <section aria-labelledby="identity-title" className="ops-card p-5 sm:p-6">
    <div className="flex items-center gap-2 text-ops-brand">
      <UserRoundSearch aria-hidden size={18} />
      <h2 className="text-lg font-semibold text-ops-text" id="identity-title">Customer identity</h2>
    </div>

    {!permitted && (
      <p className="mt-2 text-sm leading-6 text-ops-muted">
        Linking a transaction to its KYC requires a compliance review role.
      </p>
    )}

    {permitted && loadError && (
      <OpsBanner className="mt-4" variant="warning">
        Identity linkage is unavailable:
        {' '}
        {loadError}
      </OpsBanner>
    )}

    {permitted && identity && (
      <>
        <p className="mt-2 text-sm leading-6 text-ops-muted">
          Identity values stay masked here; the KYC page reveals them under its own audited step.
        </p>
        <dl className="mt-4 grid gap-3 text-sm">
          <div className="min-w-0">
            <dt className="ops-label">Partner user</dt>
            <dd className="mt-1 break-all font-mono text-xs text-ops-text">{identity.partnerUser.userId}</dd>
          </div>
          <div className="min-w-0">
            <dt className="ops-label">Account state</dt>
            <dd className="mt-1">
              <OpsStatusBadge tone={identity.partnerUser.disabledAt ? 'danger' : 'success'}>
                {identity.partnerUser.disabledAt ? 'User disabled' : 'User active'}
              </OpsStatusBadge>
            </dd>
          </div>
        </dl>

        {identity.submissions.length === 0
          ? (
              <p className="mt-4 rounded-xl border border-ops-border bg-ops-bg/60 p-3 text-sm text-ops-muted">
                This customer has no KYC submission on record.
              </p>
            )
          : (
              <ul className="mt-4 space-y-3">
                {identity.submissions.map(submission => (
                  <SubmissionRow
                    effective={submission.id === identity.effectiveSubmissionId}
                    key={submission.id}
                    submission={submission}
                  />
                ))}
              </ul>
            )}
      </>
    )}
  </section>
)

export default CustomerIdentityPanel
