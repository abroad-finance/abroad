import React from 'react';

// Define Option interface
export interface Option {
  value: string;
  label: string;
  icon?: React.ReactNode;
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
}

export function DropSelector({
  options,
  selectedOption,
  onSelectOption,
  isOpen,
  setIsOpen,
  placeholder,
  disabled = false,
}: DropSelectorProps) {
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
    <div className="relative w-full">
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className="w-full p-2 border border-gray-300 rounded-md focus:ring-0 focus:border-gray-300 text-left flex items-center justify-between bg-white disabled:bg-gray-100 disabled:cursor-not-allowed"
      >
        <span className="flex items-center truncate">
          {selectedOption ? (
            <>
              {selectedOption.icon && <span className="mr-2 flex-shrink-0">{selectedOption.icon}</span>}
              <span className="truncate">{selectedOption.label}</span>
            </>
          ) : (
            <span className="text-gray-500">{placeholder}</span>
          )}
        </span>
        <svg
          className={`w-5 h-5 text-gray-500 transform transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
        </svg>
      </button>

      {isOpen && !disabled && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
          {options.length > 0 ? (
            options.map((option) => (
              <div
                key={option.value}
                onClick={() => handleSelect(option)}
                className={`flex items-center p-2 cursor-pointer hover:bg-gray-100 ${
                  option.disabled ? 'opacity-50 cursor-not-allowed' : ''
                } ${selectedOption?.value === option.value ? 'bg-gray-200 font-semibold' : 'hover:bg-gray-50'}`}
              >
                {option.icon && <span className="mr-2 flex-shrink-0">{option.icon}</span>}
                <span className="text-gray-700 text-sm truncate">{option.label}</span>
              </div>
            ))
          ) : (
            <div className="p-2 text-gray-500 text-sm">No options available</div>
          )}
        </div>
      )}
    </div>
  );
}