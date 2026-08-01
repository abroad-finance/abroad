import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import FlowDefinitions from '../pages/Ops/FlowDefinitions'
import { clearOpsApiKey, setOpsApiKey } from '../services/admin/opsAuthStore'

const mocked = vi.hoisted(() => ({
  createFlowDefinition: vi.fn(),
  listFlowCorridors: vi.fn(),
  listFlowDefinitions: vi.fn(),
  updateFlowCorridor: vi.fn(),
  updateFlowDefinition: vi.fn(),
}))

vi.mock('../services/admin/flowAdminApi', () => mocked)

afterEach(() => {
  clearOpsApiKey()
  vi.clearAllMocks()
})

describe('FlowDefinitions fee fields', () => {
  it('explains percentage units and identifies the fixed-fee payout currency', async () => {
    setOpsApiKey('ops_key')
    mocked.listFlowDefinitions.mockResolvedValue([])
    mocked.listFlowCorridors.mockResolvedValue({
      corridors: [{
        blockchain: 'STELLAR',
        cryptoCurrency: 'USDC',
        status: 'MISSING',
        targetCurrency: 'BRL',
        updatedAt: '2026-08-01T12:00:00.000Z',
      }, {
        blockchain: 'STELLAR',
        cryptoCurrency: 'USDC',
        status: 'MISSING',
        targetCurrency: 'COP',
        updatedAt: '2026-08-01T12:00:00.000Z',
      }],
      summary: {
        defined: 0,
        missing: 2,
        total: 2,
        unsupported: 0,
      },
    })

    render(
      <MemoryRouter>
        <FlowDefinitions />
      </MemoryRouter>,
    )

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: /USDC · STELLAR → BRL/ }))

    expect(screen.getByLabelText('Percentage Fee')).toHaveAttribute('placeholder', '0.01')
    expect(screen.getByText('Enter the fee as a decimal. Example: 0.01 = 1%; 0.001 = 0.1%.')).toBeInTheDocument()
    expect(screen.getByLabelText('Fixed Fee (BRL)')).toHaveAttribute('placeholder', '2.50')
    expect(screen.getByText('Added once per transaction in the payout currency. Example: 2.50 BRL.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /USDC · STELLAR → COP/ }))

    expect(screen.getByLabelText('Fixed Fee (COP)')).toBeInTheDocument()
    expect(screen.getByText('Added once per transaction in the payout currency. Example: 2.50 COP.')).toBeInTheDocument()
  })
})
