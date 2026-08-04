import {
  fireEvent, render, screen, waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'

import KycForm from '../features/swap/components/KycForm'
import { expectNoAccessibilityViolations } from './accessibility'

vi.mock('@tolgee/react', () => ({
  useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}))

const fillAboutStep = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText('Full name'), 'Ada Lovelace')
  fireEvent.change(screen.getByLabelText('Date of birth'), { target: { value: '1990-01-01' } })
  await user.type(screen.getByLabelText('Country of nationality'), 'Brazil')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}

const fillContactStep = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText('Email'), 'ada@example.com')
  await user.type(screen.getByLabelText('Phone'), '+55 21 99999 9999')
  await user.type(screen.getByLabelText('City of residence'), 'Rio de Janeiro')
  await user.type(screen.getByLabelText('Address'), 'Avenida Atlântica 100')
  await user.click(screen.getByRole('button', { name: 'Continue' }))
}

const fillDocumentStep = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.selectOptions(screen.getByLabelText('Document type'), 'PASSPORT')
  await user.type(screen.getByLabelText('Document number'), 'P123456')
  const fileInput = document.querySelector<HTMLInputElement>('#kyc-document')
  expect(fileInput).not.toBeNull()
  if (!fileInput) return
  fireEvent.change(fileInput, {
    target: { files: [new File(['pdf'], 'identity.pdf', { type: 'application/pdf' })] },
  })
  await screen.findByText('Document selected')
}

describe('progressive identity verification', () => {
  it('has no automated accessibility violations in the initial verification step', async () => {
    const { container } = render(<KycForm canResumePayment onClose={vi.fn()} onSubmit={vi.fn()} />)

    await expectNoAccessibilityViolations(container)
  })

  it('explains purpose, privacy, payment state, and progressive structure before collecting a document', () => {
    render(<KycForm canResumePayment onClose={vi.fn()} onSubmit={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Identity verification' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Why this is needed' })).toBeInTheDocument()
    expect(screen.getByText('No payment has been created or charged yet.', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('After approval, we will continue once', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'How we use and protect your data' })).toHaveAttribute('href', expect.stringContaining('privacy-policy'))
    expect(screen.queryByLabelText('Document number')).not.toBeInTheDocument()
  })

  it('ties validation to each field, provides a linked summary, and focuses the first error', async () => {
    const user = userEvent.setup()
    render(<KycForm canResumePayment={false} onClose={vi.fn()} onSubmit={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Continue' }))

    const fullName = screen.getByLabelText('Full name')
    expect(fullName).toHaveAttribute('aria-invalid', 'true')
    expect(fullName).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Check the highlighted fields' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Date of birth: This field is required.' })).toBeInTheDocument()
  })

  it('retains entered values and the selected document after a bounded submission failure', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => ({
      error: 'Identity verification is temporarily unavailable. Your details are still here.',
      errorCode: 'service-unavailable' as const,
      ok: false as const,
    }))
    render(<KycForm canResumePayment onClose={vi.fn()} onSubmit={onSubmit} />)

    await fillAboutStep(user)
    await fillContactStep(user)
    await fillDocumentStep(user)
    await user.click(screen.getByRole('button', { name: 'Submit verification' }))

    await screen.findByRole('heading', { name: 'Verification was not submitted' })
    expect(screen.getByText('Identity verification is temporarily unavailable. Your details are still here.')).toBeInTheDocument()
    expect(screen.getByText('Document selected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try submission again' })).toBeInTheDocument()
    expect(onSubmit).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Full name')).toHaveValue('Ada Lovelace')
  })

  it('requires confirmation before discarding an in-memory sensitive draft', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<KycForm canResumePayment={false} onClose={onClose} onSubmit={vi.fn()} />)

    await user.type(screen.getByLabelText('Full name'), 'Ada')
    await user.click(screen.getByRole('button', { name: 'Cancel safely' }))

    expect(screen.getByRole('dialog', { name: 'Leave identity verification?' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Full name')).toHaveValue('Ada')
  })

  it('shows an explicit no-charge review state when approval is not immediate', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn(async () => ({
      ok: true as const,
      status: 'PENDING_APPROVAL' as const,
    }))
    render(<KycForm canResumePayment onClose={vi.fn()} onSubmit={onSubmit} />)

    await fillAboutStep(user)
    await fillContactStep(user)
    await fillDocumentStep(user)
    await user.click(screen.getByRole('button', { name: 'Submit verification' }))

    expect(await screen.findByRole('heading', { name: 'Verification received' })).toBeInTheDocument()
    expect(screen.getByText('No payment has been created or charged.', { exact: false })).toBeInTheDocument()
  })
})
