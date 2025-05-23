import React from 'react';

export interface TokenBadgeProps {
  iconSrc: string;  // token icon URL
  symbol: string;   // token symbol text
  alt?: string;     // alt text for icon
}

export const TokenBadge: React.FC<TokenBadgeProps> = ({ iconSrc, symbol, alt }) => (
  <div className="w-1/3 bg-white/60 backdrop-blur-xl rounded-4xl px-6 py-2 flex items-center justify-center">
    <img
      src={iconSrc}
      alt={alt || symbol}
      className="w-8 h-8 sm:w-12 sm:h-12 lg:w-8 lg:h-8 mr-2"
    />
    <span>{symbol}</span>
  </div>
);

export default TokenBadge;
