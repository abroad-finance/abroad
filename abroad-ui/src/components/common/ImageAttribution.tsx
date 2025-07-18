import React from 'react';
import { ATTRIBUTION_URL } from '../../features/swap/webSwap.constants';

const ImageAttribution: React.FC<{ className?: string }> = ({ className }) => {
  const handleClick = () => window.open(ATTRIBUTION_URL, '_blank');

  return (
    <button
      onClick={handleClick}
      className={`
        bg-black/40 text-white text-xs font-sans p-2 px-3 rounded-md
        backdrop-blur-md border border-white/10 cursor-pointer 
        transition-all duration-200 ease-out select-none
        hover:bg-black/50 hover:scale-102 active:scale-100
        ${className}
      `}
    >
      Rio Guayabero, Colombia by Pedro Szekely, CC BY-SA 2.0
    </button>
  );
};

export default ImageAttribution;