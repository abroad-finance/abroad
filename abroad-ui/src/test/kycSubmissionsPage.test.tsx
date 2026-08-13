import {
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

import type { OpsSession } from '../services/admin/opsAuthStore'

import KycSubmissions from '../pages/Ops/KycSubmissions'
import { setOpsSession } from '../services/admin/opsAuthStore'
import { testOpsMutationDetails } from './opsMutationTestFixtures'
import { ImmediateOpsMutationProvider } from './opsMutationTestUtils'

const kycMocks = vi.hoisted(() => ({
  assignKycReviewer: vi.fn(),
  disableKycUser: vi.fn(),
  enableKycUser: vi.fn(),
  fetchKycDocument: vi.fn(),
  getKycSubmission: vi.fn(),
  getTransactionKycLink: vi.fn(),
  listKycReviewers: vi.fn(),
  listKycSubmissions: vi.fn(),
  rejectKyc: vi.fn(),
}))

vi.mock('../services/admin/kycAdminApi', () => kycMocks)

const session: OpsSession = {
  authenticatedAt: '2026-08-02T15:00:00.000Z',
  bootstrapRequired: false,
  displayName: 'Compliance Operator',
  email: 'compliance@abroad.finance',
  kind: 'ops_user',
  permissions: [
    'kyc:decide',
    'kyc:read',
    'kyc:reveal',
  ],
  role: 'COMPLIANCE',
  sessionVersion: 1,
  stepUpExpiresAt: '2099-08-02T15:10:00.000Z',
  userId: 'reviewer-1',
}

const reviewer = {
  displayName: 'Compliance Operator',
  id: 'reviewer-1',
  role: 'COMPLIANCE' as const,
}

const maskedSubmission = {
  disabledAt: null,
  documentNumberMasked: '•••• 1234',
  documentType: 'NATIONAL_ID' as const,
  emailMasked: 'a•••@example.com',
  fullNameMasked: 'A•• L••',
  hasDocument: true,
  id: '11111111-1111-4111-8111-111111111111',
  nationality: 'BR',
  partnerId: '22222222-2222-4222-8222-222222222222',
  partnerName: 'Acme Partner',
  partnerUserId: '33333333-3333-4333-8333-333333333333',
  reviewedAt: null,
  reviewer: null,
  status: 'PENDING_APPROVAL' as const,
  submittedAt: '2026-08-01T12:00:00.000Z',
  version: 3,
}

const renderPage = (entry = '/ops/kyc') => render(
  <MemoryRouter initialEntries={[entry]}>
    <ImmediateOpsMutationProvider>
      <KycSubmissions />
    </ImmediateOpsMutationProvider>
  </MemoryRouter>,
)

beforeEach(() => {
  setOpsSession(session)
  kycMocks.listKycReviewers.mockResolvedValue([reviewer])
  kycMocks.listKycSubmissions.mockResolvedValue({
    items: [maskedSubmission],
    page: 1,
    pageSize: 20,
    total: 1,
  })
})

afterEach(() => {
  setOpsSession(null)
  vi.clearAllMocks()
})

describe('KYC review queue', () => {
  test('keeps identity data masked and does not apply draft filters while typing', async () => {
    renderPage('/ops/kyc?status=PENDING_APPROVAL')

    await screen.findByRole('heading', { name: 'A•• L••' })
    expect(screen.getByText('a•••@example.com')).toBeVisible()
    expect(screen.getByText(/•••• 1234/)).toBeVisible()
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument()
    expect(kycMocks.listKycSubmissions).toHaveBeenCalledWith(expect.objectContaining({
      status: 'PENDING_APPROVAL',
    }))

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('User or document search'), 'Ada')
    expect(kycMocks.listKycSubmissions).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Apply filters' }))
    await waitFor(() => expect(kycMocks.listKycSubmissions).toHaveBeenCalledTimes(2))
    expect(kycMocks.listKycSubmissions).toHaveBeenLastCalledWith(expect.objectContaining({
      query: 'Ada',
      status: 'PENDING_APPROVAL',
    }))
  })

  test('reveals sensitive evidence only in an audited accessible dialog', async () => {
    kycMocks.getKycSubmission.mockResolvedValue({
      address: '123 Private Street',
      city: 'São Paulo',
      dateOfBirth: '1990-01-01T00:00:00.000Z',
      disabledAt: null,
      documentNumber: 'BR-PRIVATE-1234',
      documentType: 'NATIONAL_ID',
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      hasDocument: true,
      id: maskedSubmission.id,
      nationality: 'BR',
      partnerId: maskedSubmission.partnerId,
      partnerName: 'Acme Partner',
      partnerUserId: maskedSubmission.partnerUserId,
      phone: '+5511999999999',
      reviewedAt: null,
      reviewer,
      status: 'PENDING_APPROVAL',
      submittedAt: maskedSubmission.submittedAt,
      userId: 'external-user-1',
      version: 3,
    })
    renderPage()

    const revealButton = await screen.findByRole('button', { name: 'Reveal sensitive details' })
    const user = userEvent.setup()
    await user.click(revealButton)

    const dialog = await screen.findByRole('dialog', { name: 'Identity evidence' })
    expect(within(dialog).getByText('Ada Lovelace')).toBeVisible()
    expect(within(dialog).getByText('123 Private Street')).toBeVisible()
    expect(kycMocks.getKycSubmission).toHaveBeenCalledWith(maskedSubmission.id)
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Close dialog' })).toHaveFocus())

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Identity evidence' })).not.toBeInTheDocument()
    expect(revealButton).toHaveFocus()
  })

  test('assigns review ownership with the row version', async () => {
    const secondReviewer = {
      displayName: 'Review Administrator',
      id: 'reviewer-2',
      role: 'ADMINISTRATOR' as const,
    }
    kycMocks.listKycReviewers.mockResolvedValue([reviewer, secondReviewer])
    kycMocks.assignKycReviewer.mockResolvedValue({
      id: maskedSubmission.id,
      reviewer: secondReviewer,
      version: 4,
    })
    renderPage()

    const card = (await screen.findByRole('heading', { name: 'A•• L••' })).closest('article')
    expect(card).not.toBeNull()
    const user = userEvent.setup()
    await user.selectOptions(
      within(card as HTMLElement).getByRole('combobox', { name: 'Review owner for A•• L••' }),
      'reviewer-2',
    )
    await user.click(within(card as HTMLElement).getByRole('button', { name: 'Assign' }))

    await waitFor(() => {
      expect(kycMocks.assignKycReviewer).toHaveBeenCalledWith(
        maskedSubmission.id,
        'reviewer-2',
        { ...testOpsMutationDetails, expectedVersion: 3 },
      )
    })
  })

  test('opens a single linked submission and offers the way back to the queue', async () => {
    renderPage(`/ops/kyc?kycId=${maskedSubmission.id}`)

    await screen.findByRole('heading', { name: 'A•• L••' })
    expect(kycMocks.listKycSubmissions).toHaveBeenCalledWith(expect.objectContaining({
      kycId: maskedSubmission.id,
    }))
    expect(screen.getByText(/Showing one linked submission/)).toBeVisible()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Return to the full queue' }))
    await waitFor(() => expect(kycMocks.listKycSubmissions).toHaveBeenLastCalledWith(expect.objectContaining({
      kycId: undefined,
    })))
    expect(screen.queryByText(/Showing one linked submission/)).not.toBeInTheDocument()
  })

  test('does not query the compliance queue for unauthorized roles', async () => {
    setOpsSession({ ...session, permissions: ['overview:read'], role: 'VIEWER' })
    renderPage()

    expect(await screen.findByText('Your role does not include compliance review access.')).toBeVisible()
    expect(kycMocks.listKycSubmissions).not.toHaveBeenCalled()
    expect(kycMocks.listKycReviewers).not.toHaveBeenCalled()
  })
})
