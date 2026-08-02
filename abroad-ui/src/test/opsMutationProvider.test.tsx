import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type { OpsMutationDetails, OpsMutationPolicy } from '../services/admin/opsMutationTypes'

import { useOpsMutation } from '../pages/Ops/shared/opsMutationContext'
import { OpsMutationProvider } from '../pages/Ops/shared/OpsMutationProvider'
import { setOpsSession } from '../services/admin/opsAuthStore'

const identityMocks = vi.hoisted(() => ({
  getOpsMutationPolicy: vi.fn(),
  stepUpOpsSession: vi.fn(),
}))

vi.mock('../services/admin/opsIdentityApi', () => identityMocks)

const policy: OpsMutationPolicy = {
  action: 'configuration.asset.update',
  approvalClass: 'STEP_UP',
  confirmation: 'UPDATE ASSET',
  expectedVersion: true,
  impact: 'Changes production asset coverage and payment routing eligibility.',
  permission: 'configuration:manage',
  stepUpRequired: true,
}

const session = {
  authenticatedAt: '2026-08-02T15:00:00.000Z',
  bootstrapRequired: false,
  displayName: 'Ana Operator',
  email: 'ana@abroad.finance',
  kind: 'ops_user' as const,
  permissions: ['configuration:manage'],
  role: 'ADMINISTRATOR',
  sessionVersion: 1,
  stepUpExpiresAt: '2099-08-02T15:10:00.000Z',
  userId: 'ops-user-1',
}

const Trigger = ({ execute }: { execute: (details: OpsMutationDetails) => Promise<unknown> }) => {
  const { requestMutation } = useOpsMutation()
  return (
    <button
      onClick={() => void requestMutation({
        action: 'configuration.asset.update',
        execute,
        expectedVersion: 7,
        resourceLabel: 'USDC on STELLAR',
        title: 'Update crypto asset coverage',
      }).catch(() => undefined)}
      type="button"
    >
      Save asset
    </button>
  )
}

beforeEach(() => {
  identityMocks.getOpsMutationPolicy.mockResolvedValue(policy)
  identityMocks.stepUpOpsSession.mockResolvedValue(session)
  setOpsSession(session)
})

afterEach(() => {
  setOpsSession(null)
  vi.clearAllMocks()
})

describe('OpsMutationProvider', () => {
  it('requires an explicit reason and typed confirmation before executing', async () => {
    const execute = vi.fn<[OpsMutationDetails], Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(
      <OpsMutationProvider>
        <Trigger execute={execute} />
      </OpsMutationProvider>,
    )

    const trigger = screen.getByRole('button', { name: 'Save asset' })
    await user.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: 'Update crypto asset coverage' })
    expect(dialog).toHaveTextContent(policy.impact)
    expect(dialog).toHaveTextContent('USDC on STELLAR')
    expect(execute).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Operational reason'), 'Enable the verified Stellar issuer')
    await user.type(screen.getByLabelText(/Type UPDATE ASSET to confirm/), 'UPDATE ASSET')
    await user.click(screen.getByRole('button', { name: 'Execute operation' }))

    await waitFor(() => expect(execute).toHaveBeenCalledOnce())
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      confirmation: 'UPDATE ASSET',
      expectedVersion: 7,
      reason: 'Enable the verified Stellar issuer',
    }))
    expect(execute.mock.calls[0]?.[0].idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('performs step-up before a protected operation and restores focus on cancellation', async () => {
    setOpsSession({ ...session, stepUpExpiresAt: '2020-08-02T15:10:00.000Z' })
    const execute = vi.fn<[OpsMutationDetails], Promise<{ ok: boolean }>>().mockResolvedValue({ ok: true })
    const user = userEvent.setup()
    render(
      <OpsMutationProvider>
        <Trigger execute={execute} />
      </OpsMutationProvider>,
    )

    const trigger = screen.getByRole('button', { name: 'Save asset' })
    trigger.focus()
    await user.click(trigger)
    await screen.findByRole('dialog')
    await waitFor(() => expect(screen.getByLabelText('Operational reason')).toHaveFocus())
    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()

    await user.click(trigger)
    await screen.findByRole('dialog')
    await user.type(screen.getByLabelText('Operational reason'), 'Correct an approved asset configuration')
    await user.type(screen.getByLabelText(/Type UPDATE ASSET to confirm/), 'UPDATE ASSET')
    await user.click(screen.getByRole('button', { name: 'Verify and execute' }))

    await waitFor(() => expect(identityMocks.stepUpOpsSession).toHaveBeenCalledOnce())
    await waitFor(() => expect(execute).toHaveBeenCalledOnce())
  })
})
