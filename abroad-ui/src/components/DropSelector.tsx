import React from 'react';

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
        className="w-full p-3 text-lg border border-gray-300 rounded-md focus:ring-0 focus:border-gray-300 text-left flex items-center justify-between bg-white disabled:bg-gray-100 disabled:cursor-not-allowed" /* Increased padding and text size */
      >
        <span className="flex items-center truncate">
          {selectedOption ? (
            <>
              {selectedOption.icon && !selectedOption.iconUrl && <span className="mr-3 flex-shrink-0">{selectedOption.icon}</span>} {/* Increased margin */}
              {selectedOption.iconUrl && <img src={selectedOption.iconUrl} alt="" className="w-6 h-6 mr-3 rounded-full flex-shrink-0" />} {/* Added image icon */}
              <span className="truncate">{selectedOption.label}</span>
            </>
          ) : (
            <span className="text-gray-500 text-lg">{placeholder}</span> /* Ensured placeholder text size */
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
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-md shadow-lg max-h-72 overflow-auto"> {/* Increased max-h slightly */}
          {options.length > 0 ? (
            options.map((option) => (
              <div
                key={option.value}
                onClick={() => handleSelect(option)}
                className={`flex items-center p-3 cursor-pointer hover:bg-gray-100 ${ /* Increased padding */
                  option.disabled ? 'opacity-50 cursor-not-allowed' : ''
                } ${selectedOption?.value === option.value ? 'bg-gray-200 font-semibold' : 'hover:bg-gray-50'}`}
              >
                {option.icon && !option.iconUrl && <span className="mr-3 flex-shrink-0">{option.icon}</span>} {/* Increased margin */}
                {option.iconUrl && <img src={option.iconUrl} alt="" className="w-6 h-6 mr-3 rounded-full flex-shrink-0" />} {/* Added image icon */}
                <span className="text-gray-700 text-lg truncate">{option.label}</span> {/* Increased text size */}
              </div>
            ))
          ) : (
            <div className="p-3 text-gray-500 text-lg">No options available</div> /* Increased padding and text size */
          )}
        </div>
      )}
    </div>
  );
}