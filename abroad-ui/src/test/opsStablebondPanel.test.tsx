import {
  fireEvent, render, screen, within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'

import type { OpsStablebondResponse } from '../services/admin/treasuryTypes'

import { StablebondPanel } from '../pages/Ops/treasury/StablebondPanel'
import { ImmediateOpsMutationProvider } from './opsMutationTestUtils'

const treasuryMocks = vi.hoisted(() => ({
  acquireStablebond: vi.fn(),
  getStablebondPosition: vi.fn(),
  getTreasuryBalances: vi.fn(),
  getTreasuryMovements: vi.fn(),
  getTreasurySnapshots: vi.fn(),
  openStablebondTrustline: vi.fn(),
  registerStablebondBasis: vi.fn(),
  unwindStablebond: vi.fn(),
}))

vi.mock('../services/admin/treasuryAdminApi', () => treasuryMocks)

const position: OpsStablebondResponse = {
  disabledReason: null,
  enabled: true,
  error: null,
  position: {
    accruedFiat: 38.022,
    accruedUsd: 7.454,
    annualYieldBps: 1276,
    assetCode: 'TESOURO',
    effectiveAnnualBps: 1180,
    entryNavFiat: 1.2,
    fiatCurrency: 'BRL',
    heldTokens: 1000,
    issuer: 'GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC',
    jitUnwindCapUsdc: 5000,
    maxSlippageBps: 50,
    navFiat: 1.238022,
    navObservedAt: '2026-08-06T13:39:50.782Z',
    navUsd: 0.242721,
    openedAt: '2026-08-01T00:00:00.000Z',
    principalFiat: 1200,
    status: 'OPEN',
    symbol: 'TESOURO',
    unwindable: {
      feasible: true, reason: null, spreadBps: 4, testedUsdc: 5000,
    },
    valueFiat: 1238.022,
    valueUsd: 242.721,
    venue: 'STABLEBOND_POSITION',
  },
  recentUnwinds: [{
    direction: 'UNWIND',
    failureReason: null,
    id: 'execution-1',
    minReceive: 1000,
    navUsdPerToken: 0.242721,
    onChainId: 'abc123',
    quotedAt: '2026-08-06T10:00:00.000Z',
    quotedReceive: 1000.4,
    receiveAsset: 'USDC',
    receivedAmount: 999.6,
    sendAmount: 4119.9299,
    sendAsset: 'TESOURO',
    settledAt: '2026-08-06T10:00:05.000Z',
    spreadBps: 4,
    status: 'CONFIRMED',
  }],
}

const onChanged = vi.fn()

const renderPanel = (
  overview: null | OpsStablebondResponse,
  error: null | string = null,
  canManage = false,
) => render(
  <ImmediateOpsMutationProvider>
    <StablebondPanel
      canManage={canManage}
      error={error}
      loading={false}
      onChanged={onChanged}
      onRetry={vi.fn()}
      overview={overview}
    />
  </ImmediateOpsMutationProvider>,
)

beforeEach(() => {
  vi.clearAllMocks()
  treasuryMocks.openStablebondTrustline.mockResolvedValue({
    balance: null, limit: null, onChainId: 'trust-1', outcome: 'opened', reason: null,
  })
  treasuryMocks.acquireStablebond.mockResolvedValue({
    executionId: 'execution-2',
    onChainId: 'abc456',
    outcome: 'confirmed',
    reason: null,
    receivedAmount: 4119,
    spreadBps: 6,
  })
  treasuryMocks.unwindStablebond.mockResolvedValue({
    executionId: 'execution-3',
    onChainId: 'abc789',
    outcome: 'confirmed',
    reason: null,
    receivedAmount: 999.6,
    spreadBps: 4,
  })
  treasuryMocks.registerStablebondBasis.mockResolvedValue(position)
})

/**
 * Scope a query to the card carrying `label`. The summary cards and the unwind
 * table deliberately show the same figures, so an unscoped query cannot say
 * which surface it actually asserted on.
 */
const card = (label: string) => {
  const node = screen.getByText(label).closest('.ops-card')
  if (!node) throw new Error(`No card found for "${label}"`)
  return within(node as HTMLElement)
}

describe('StablebondPanel', () => {
  test('shows the position, its accrual and the rate side by side', () => {
    renderPanel(position)

    expect(screen.getByRole('heading', { name: 'Yield position' })).toBeVisible()
    expect(card('TESOURO held').getByText('1,000')).toBeVisible()
    expect(card('TESOURO held').getByText(/1,238.02 BRL/)).toBeVisible()
    expect(card('Accrued yield').getByText('38.02')).toBeVisible()
    expect(card('Rate').getByText('12.76%')).toBeVisible()
    expect(card('Rate').getByText(/11.8% realised so far/)).toBeVisible()
  })

  // The panel exists to make the cost as legible as the yield. A console that
  // reports 12.76% accruing without the spread to get out tells half the story.
  test('shows the live cost of unwinding as prominently as the yield', () => {
    renderPanel(position)

    expect(card('Unwind now').getByText('4 bps')).toBeVisible()
    expect(card('Unwind now').getByText('Feasible')).toBeVisible()
    expect(card('Unwind now').getByText(/cost to raise \$5,000 · bound 50 bps/)).toBeVisible()
  })

  test('marks an infeasible unwind as refused and names the reason', () => {
    renderPanel({
      ...position,
      position: position.position && {
        ...position.position,
        unwindable: {
          feasible: false, reason: 'slippage_bound_exceeded', spreadBps: null, testedUsdc: 5000,
        },
      },
    })

    expect(card('Unwind now').getByText('Refused')).toBeVisible()
    expect(card('Unwind now').getByText('slippage_bound_exceeded')).toBeVisible()
  })

  // The invariant that must survive into the UI: enabled-but-unreadable is an
  // error, not a zero position.
  test('says the value is unknown, not zero, when the position cannot be read', () => {
    renderPanel({
      ...position, error: 'position_balance_unreadable', position: null, recentUnwinds: [],
    })

    expect(screen.getByRole('alert')).toHaveTextContent(/Treat its value as unknown, not as zero/)
    expect(screen.queryByText('Accrued yield')).not.toBeInTheDocument()
  })

  test('explains why the position is off instead of rendering an empty position', () => {
    renderPanel({
      disabledReason: 'STABLEBOND_JIT_UNWIND_CAP_USDC is not set',
      enabled: false,
      error: null,
      position: null,
      recentUnwinds: [],
    })

    expect(screen.getByText('Yield position is off.')).toBeVisible()
    expect(screen.getByText(/STABLEBOND_JIT_UNWIND_CAP_USDC is not set/)).toBeVisible()
  })

  test('lists each unwind with the quote it took and the spread it paid', () => {
    renderPanel(position)

    const row = screen.getByRole('row', { name: /Aug 6, 2026/ })
    expect(row).toHaveTextContent('4,119.9299')
    expect(row).toHaveTextContent('1,000.4')
    expect(row).toHaveTextContent('999.6')
    expect(row).toHaveTextContent('4 bps')
  })

  test('labels which direction each execution went', () => {
    renderPanel({
      ...position,
      recentUnwinds: [position.recentUnwinds[0], {
        ...position.recentUnwinds[0],
        direction: 'ACQUIRE',
        id: 'execution-2',
        quotedAt: '2026-08-05T09:00:00.000Z',
        sendAsset: 'USDC',
      }],
    })

    expect(screen.getByRole('row', { name: /Aug 5, 2026/ })).toHaveTextContent('Acquire')
    expect(screen.getByRole('row', { name: /Aug 6, 2026/ })).toHaveTextContent('Unwind')
  })

  test('renders a dash rather than a zero for an unmeasured fill', () => {
    renderPanel({
      ...position,
      recentUnwinds: [{
        ...position.recentUnwinds[0], receivedAmount: null, spreadBps: null, status: 'AMBIGUOUS',
      }],
    })

    const row = screen.getByRole('row', { name: /Aug 6, 2026/ })
    expect(row).toHaveTextContent('Ambiguous')
    expect(row.textContent).toContain('—')
  })

  test('surfaces a panel-level refresh failure with its own retry', () => {
    renderPanel(position, 'Provider timeout')

    expect(screen.getByRole('alert')).toHaveTextContent('Provider timeout')
    expect(screen.getByRole('button', { name: 'Retry this panel' })).toBeVisible()
  })

  test('tells the operator the realised rate is not meaningful yet', () => {
    renderPanel({
      ...position,
      position: position.position && { ...position.position, effectiveAnnualBps: null },
    })

    expect(card('Rate').getByText('Realised rate available after an hour held')).toBeVisible()
  })

  describe('operator actions', () => {
    /** Open the dialog from the toolbar, fill it, and submit from inside it. */
    const runExecution = async (cta: 'Acquire' | 'Unwind', label: string, amount: string) => {
      await userEvent.click(screen.getByRole('button', { name: cta }))
      const dialog = within(screen.getByRole('dialog'))
      // fireEvent.change rather than userEvent.type: this asserts on the amount
      // that gets submitted, and per-keystroke typing on a controlled number
      // input drops characters under parallel test execution.
      fireEvent.change(dialog.getByLabelText(label), { target: { value: amount } })
      await userEvent.click(dialog.getByRole('button', { name: cta }))
    }

    test('hides every action from an operator without treasury:manage', () => {
      renderPanel(position)

      expect(screen.queryByRole('button', { name: 'Unwind' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Acquire' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Open trustline' })).not.toBeInTheDocument()
    })

    test('offers the actions to an operator who can manage treasury', () => {
      renderPanel(position, null, true)

      expect(screen.getByRole('button', { name: 'Open trustline' })).toBeVisible()
      expect(screen.getByRole('button', { name: 'Re-base' })).toBeVisible()
      expect(screen.getByRole('button', { name: 'Acquire' })).toBeVisible()
      expect(screen.getByRole('button', { name: 'Unwind' })).toBeVisible()
    })

    test('offers no actions at all while the position is off', () => {
      renderPanel({
        disabledReason: 'STABLEBOND_JIT_UNWIND_CAP_USDC is not set',
        enabled: false,
        error: null,
        position: null,
        recentUnwinds: [],
      }, null, true)

      expect(screen.queryByRole('button', { name: 'Unwind' })).not.toBeInTheDocument()
    })

    test('opens the trustline and reports the outcome', async () => {
      renderPanel(position, null, true)
      await userEvent.click(screen.getByRole('button', { name: 'Open trustline' }))

      expect(treasuryMocks.openStablebondTrustline).toHaveBeenCalledTimes(1)
      expect(await screen.findByText(/Trustline opened/)).toBeVisible()
      expect(onChanged).toHaveBeenCalled()
    })

    test('unwinds the amount entered and reports the spread actually paid', async () => {
      renderPanel(position, null, true)
      await runExecution('Unwind', 'USDC to raise', '100')

      expect(treasuryMocks.unwindStablebond).toHaveBeenCalledWith(100, expect.anything())
      expect(await screen.findByText(/received 999.6 at 4 bps/)).toBeVisible()
    })

    test('acquires with the amount entered', async () => {
      renderPanel(position, null, true)
      await runExecution('Acquire', 'USDC to spend', '500')

      expect(treasuryMocks.acquireStablebond).toHaveBeenCalledWith(500, expect.anything())
    })

    test('refuses a non-positive amount without calling the API', async () => {
      renderPanel(position, null, true)
      await runExecution('Unwind', 'USDC to raise', '0')

      expect(await screen.findByText('Enter a positive USDC amount')).toBeVisible()
      expect(treasuryMocks.unwindStablebond).not.toHaveBeenCalled()
    })

    // An ambiguous execution must read as "stop and reconcile", never as a
    // failure the operator would be tempted to retry.
    test('tells the operator not to retry an ambiguous execution', async () => {
      treasuryMocks.unwindStablebond.mockResolvedValueOnce({
        executionId: 'execution-9',
        onChainId: 'abc999',
        outcome: 'ambiguous',
        reason: 'stellar_submission_ambiguous',
        receivedAmount: null,
        spreadBps: null,
      })
      renderPanel(position, null, true)
      await runExecution('Unwind', 'USDC to raise', '100')

      const banner = await screen.findByText(/Do NOT retry/)
      expect(banner).toHaveTextContent('execution-9')
    })

    test('says nothing moved when the venue refused', async () => {
      treasuryMocks.unwindStablebond.mockRejectedValueOnce(new Error('The Stablebond operation was refused: slippage_bound_exceeded'))
      renderPanel(position, null, true)
      await runExecution('Unwind', 'USDC to raise', '100')

      expect(await screen.findByText(/slippage_bound_exceeded/)).toBeVisible()
    })
  })
})
