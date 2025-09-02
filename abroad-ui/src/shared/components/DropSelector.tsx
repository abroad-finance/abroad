import React, { useEffect, useRef } from 'react'

// Define Option interface
export interface Option {
  disabled?: boolean
  icon?: React.ReactNode // Icons are expected to be scaled by the parent providing them
  iconUrl?: string // URL for image icons
  label: string
  value: string
}

interface DropSelectorProps {
  disabled?: boolean
  isOpen: boolean
  onSelectOption: (option: Option) => void
  options: Option[]
  placeholder: string
  placeholderIcons?: string[]
  selectedOption: null | Option
  setIsOpen: (isOpen: boolean) => void
  textColor?: string
}

export function DropSelector({
  disabled = false,
  isOpen,
  onSelectOption,
  options,
  placeholder,
  placeholderIcons = [],
  selectedOption,
  setIsOpen,
  textColor,
}: DropSelectorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const listboxIdRef = useRef(`drop-selector-${Math.random().toString(36).slice(2)}`)
  const listboxId = listboxIdRef.current

  // Close when clicking/touching outside — use pointerdown to cover mouse + touch.
  useEffect(() => {
    if (!isOpen) return

    const handlePointerDownOutside = (event: PointerEvent) => {
      const el = rootRef.current
      if (!el) return
      if (!el.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('pointerdown', handlePointerDownOutside)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutside)
    }
  }, [isOpen, setIsOpen])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isOpen, setIsOpen])

  const handleToggle = () => {
    if (!disabled) setIsOpen(!isOpen)
  }

  const handleSelect = (option: Option) => {
    if (!option.disabled) {
      onSelectOption(option)
      setIsOpen(false)
    }
  }

  return (
    <div className="relative w-full" ref={rootRef}>
      <button
        aria-controls={isOpen ? listboxId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="w-full p-3 text-lg font-semibold border-none rounded-none focus:ring-0 focus:outline-none text-left flex items-center justify-between bg-transparent disabled:bg-transparent disabled:cursor-not-allowed"
        disabled={disabled}
        onClick={handleToggle}
        type="button"
      >
        <span className="flex items-center truncate">
          {selectedOption
            ? (
                <>
                  {selectedOption.icon && !selectedOption.iconUrl && (
                    <span className="mr-3 flex-shrink-0">{selectedOption.icon}</span>
                  )}
                  {selectedOption.iconUrl && (
                    <img
                      alt=""
                      className="w-8 h-8 mr-3 rounded-full flex-shrink-0"
                      src={selectedOption.iconUrl}
                    />
                  )}
                  <span className="truncate font-semibold" style={{ color: textColor }}>
                    {selectedOption.label}
                  </span>
                </>
              )
            : (
                <>
                  {placeholderIcons.length > 0 && (
                    <div className="flex items-center mr-3 relative">
                      {placeholderIcons.map((iconUrl, index) => (
                        <img
                          alt=""
                          className="w-8 h-8 rounded-full flex-shrink-0 border border-white"
                          key={index}
                          src={iconUrl}
                          style={{
                            marginLeft: index > 0 ? '-3px' : '0',
                            zIndex: placeholderIcons.length - index,
                          }}
                        />
                      ))}
                    </div>
                  )}
                  <span className="text-lg font-semibold" style={{ color: textColor || '#9CA3AF' }}>
                    {placeholder}
                  </span>
                </>
              )}
        </span>
        <svg
          aria-hidden="true"
          className={`w-7 h-7 text-gray-500 transform transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
        </svg>
      </button>

      {isOpen && !disabled && (
        <div
          aria-activedescendant={selectedOption ? `${listboxId}-${selectedOption.value}` : undefined}
          className="absolute z-10 mt-2.5 inset-x-0 bg-white border border-gray-300 rounded-xl shadow-lg max-h-72 overflow-auto"
          id={listboxId}
          onClick={e => e.stopPropagation()}
          // Prevent inside interactions from reaching the document listener
          onPointerDown={e => e.stopPropagation()}
          role="listbox"
        >
          {options.length > 0
            ? (
                options.map((option) => {
                  const isSelected = selectedOption?.value === option.value
                  return (
                    <div
                      aria-disabled={option.disabled || undefined}
                      aria-selected={isSelected}
                      className={`flex items-center px-3 py-2 cursor-pointer ${option.disabled
                        ? 'opacity-50 cursor-not-allowed'
                        : isSelected
                          ? 'bg-gray-200 font-semibold'
                          : 'hover:bg-gray-50'
                      }`}
                      id={`${listboxId}-${option.value}`}
                      key={option.value}
                      // Select on pointerdown so it always wins the race with the outside listener
                      onPointerDown={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (!option.disabled) handleSelect(option)
                      }}
                      role="option"
                    >
                      {option.icon && !option.iconUrl && (
                        <span className="mr-3 flex-shrink-0">{option.icon}</span>
                      )}
                      {option.iconUrl && (
                        <img
                          alt=""
                          className="w-8 h-8 mr-3 rounded-full flex-shrink-0"
                          src={option.iconUrl}
                        />
                      )}
                      <span className="text-gray-700 text-lg font-semibold truncate">
                        {option.label}
                      </span>
                    </div>
                  )
                })
              )
            : (
                <div className="px-3 py-2 text-gray-500 text-lg">No options available</div>
              )}
        </div>
      )}
    </div>
  )
}
