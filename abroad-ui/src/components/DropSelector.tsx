import React, { useRef, useEffect } from 'react';

// Define Option interface
export interface Option {
  value: string;
  label: string;
  icon?: React.ReactNode; // Icons are expected to be scaled by the parent providing them
  iconUrl?: string; // URL for image icons
  disabled?: boolean;
}

interface DropSelectorProps {
  options: Option[];
  selectedOption: Option | null;
  onSelectOption: (option: Option) => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  placeholder: string;
  disabled?: boolean;
  textColor?: string;
  placeholderIcons?: string[];
}

export function DropSelector({
  options,
  selectedOption,
  onSelectOption,
  isOpen,
  setIsOpen,
  placeholder,
  disabled = false,
  textColor,
  placeholderIcons = [],
}: DropSelectorProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, setIsOpen]);
  const handleToggle = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  const handleSelect = (option: Option) => {
    if (!option.disabled) {
      onSelectOption(option);
      setIsOpen(false);
    }
  };

  return (
    <div ref={dropdownRef} className="relative w-full">
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className="w-full p-3 text-lg font-semibold border-none rounded-none focus:ring-0 focus:outline-none text-left flex items-center justify-between bg-transparent disabled:bg-transparent disabled:cursor-not-allowed" /* Removed background and border */
      >
        <span className="flex items-center truncate">
          {selectedOption ? (
            <>
              {selectedOption.icon && !selectedOption.iconUrl && <span className="mr-3 flex-shrink-0">{selectedOption.icon}</span>} {/* Increased margin */}
              {selectedOption.iconUrl && <img src={selectedOption.iconUrl} alt="" className="w-8 h-8 mr-3 rounded-full flex-shrink-0" />} {/* Made 50% bigger total */}
              <span className="truncate font-semibold" style={{ color: textColor }}>{selectedOption.label}</span>
            </>
          ) : (
            <>
              {placeholderIcons.length > 0 && (
                <div className="flex items-center mr-3 relative">
                  {placeholderIcons.map((iconUrl, index) => (
                    <img 
                      key={index} 
                      src={iconUrl} 
                      alt="" 
                      className="w-8 h-8 rounded-full flex-shrink-0 border border-white" 
                      style={{ 
                        marginLeft: index > 0 ? '-3px' : '0',
                        zIndex: placeholderIcons.length - index 
                      }}
                    />
                  ))}
                </div>
              )}
              <span className="text-lg font-semibold" style={{ color: textColor || '#9CA3AF' }}>{placeholder}</span>
            </>
          )}
        </span>
        <svg
          className={`w-7 h-7 text-gray-500 transform transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} /* Increased icon size */
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
        </svg>
      </button>

      {isOpen && !disabled && (
        <div className="absolute z-10 mt-2.5 -mx-6 left-0 right-0 bg-white border border-gray-300 rounded-xl shadow-lg max-h-72 overflow-auto">
          {options.length > 0 ? (
            options.map((option) => (
              <div
                key={option.value}
                onClick={() => handleSelect(option)}
                className={`flex items-center px-3 py-2 cursor-pointer hover:bg-gray-100 ${
                  option.disabled ? 'opacity-50 cursor-not-allowed' : ''
                } ${selectedOption?.value === option.value ? 'bg-gray-200 font-semibold' : 'hover:bg-gray-50'}`}
              >
                {option.icon && !option.iconUrl && <span className="mr-3 flex-shrink-0">{option.icon}</span>}
                {option.iconUrl && <img src={option.iconUrl} alt="" className="w-8 h-8 mr-3 rounded-full flex-shrink-0" />}
                <span className="text-gray-700 text-lg font-semibold truncate">{option.label}</span>
              </div>
            ))
          ) : (
            <div className="px-3 py-2 text-gray-500 text-lg">No options available</div>
          )}
        </div>
      )}
    </div>
  );
}