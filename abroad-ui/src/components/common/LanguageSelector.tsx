import React from 'react'

export interface LanguageSelectorProps {
  ariaLabel?: string
  className?: string
  languages: string[]
  onChange: (lng: string) => void
  value: string
  variant?: 'desktop' | 'mobile'
}

/**
 * Stateless & controlled language selector. All Tolgee logic has been moved
 * to the `useLanguageSelector` hook. This component is purely presentational.
 */
const LanguageSelector: React.FC<LanguageSelectorProps> = ({
  ariaLabel = 'Seleccionar idioma',
  className = '',
  languages,
  onChange,
  value,
  variant = 'desktop',
}) => {
  const styles = variant === 'mobile'
    ? 'appearance-none bg-[#356E6A]/5 border border-white/30 text-[#356E6A] text-xs font-medium px-2 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#356E6A]/40'
    : 'appearance-none bg-white/20 text-white text-sm font-medium px-3 py-2 pr-8 rounded-xl focus:outline-none focus:ring-2 focus:ring-white/40 hover:bg-white/30 cursor-pointer'

  const caret = variant === 'mobile'
    ? 'pointer-events-none absolute inset-y-0 right-2 flex items-center text-[#356E6A] text-[10px]'
    : 'pointer-events-none absolute inset-y-0 right-2 flex items-center text-white text-xs'

  return (
    <div className={`relative ${className}`}>
      <select
        aria-label={ariaLabel}
        className={styles}
        onChange={e => onChange(e.target.value)}
        value={value}
      >
        {languages.map(l => (
          <option className={variant === 'mobile' ? 'text-black' : 'text-black'} key={l} value={l}>
            {l.toUpperCase()}
          </option>
        ))}
      </select>
      <span className={caret}>▼</span>
    </div>
  )
}

export default LanguageSelector
