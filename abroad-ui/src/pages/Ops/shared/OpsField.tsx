import type {
  ReactElement,
  ReactNode,
} from 'react'

import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
} from 'react'

import { cn } from '../../../shared/utils'

type FieldControlProps = {
  'aria-describedby'?: string
  'aria-invalid'?: 'false' | 'true' | boolean
  'autoComplete'?: string
  'id'?: string
  'name'?: string
}

interface OpsFieldProps {
  children: ReactNode
  className?: string
  error?: ReactNode
  hint?: ReactNode
  label: ReactNode
}

const appendDescription = (...ids: Array<string | undefined>): string | undefined => {
  const value = ids.filter(Boolean).join(' ')
  return value || undefined
}

/**
 * Accessible form-field contract for Ops. A single native or custom control gets
 * a stable id/name, explicit label, browser autocomplete intent, associated help
 * and validation text, and the shared invalid-state semantics.
 */
export const OpsField = ({
  children,
  className,
  error,
  hint,
  label,
}: OpsFieldProps) => {
  const generatedId = useId()
  const hintId = `${generatedId}-hint`
  const errorId = `${generatedId}-error`
  const control = isValidElement<FieldControlProps>(children)
    ? children as ReactElement<FieldControlProps>
    : null
  const controlId = control?.props.id ?? generatedId
  const hasError = Boolean(error)

  useEffect(() => {
    if (!hasError) return
    const frame = window.requestAnimationFrame(() => {
      const firstInvalid = document.querySelector<HTMLElement>('#ops-main-content [aria-invalid="true"]')
      const activeIsInvalid = document.activeElement instanceof HTMLElement
        && document.activeElement.getAttribute('aria-invalid') === 'true'
      if (!activeIsInvalid) firstInvalid?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [hasError])

  const describedBy = appendDescription(
    control?.props['aria-describedby'],
    hint ? hintId : undefined,
    error ? errorId : undefined,
  )
  const enhancedControl = control
    ? cloneElement(control, {
        'aria-describedby': describedBy,
        'aria-invalid': hasError || undefined,
        'autoComplete': control.props.autoComplete ?? 'off',
        'id': controlId,
        'name': control.props.name ?? controlId,
      })
    : children

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label className="ops-label" htmlFor={controlId}>{label}</label>
      {enhancedControl}
      {hint && <span className="text-xs leading-5 text-ops-muted" id={hintId}>{hint}</span>}
      {error && <span className="text-xs leading-5 text-rose-700" id={errorId} role="alert">{error}</span>}
    </div>
  )
}
