import React from 'react';

export interface TokenBadgeProps {
  iconSrc: string;  // token icon URL
  symbol: string;   // token symbol text
  alt?: string;     // alt text for icon
}

export const TokenBadge: React.FC<TokenBadgeProps> = ({ iconSrc, symbol, alt }) => (
  <div className="bg-white/60 backdrop-blur-xl rounded-4xl px-4 py-2 flex items-center justify-center">
    <img
      src={iconSrc}
      alt={alt || symbol}
      className="w-8 h-8 mr-2"
    />
    <span>{symbol}</span>
  </div>
);

export default TokenBadge;
