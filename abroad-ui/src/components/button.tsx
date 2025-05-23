import React from "react";

export function Button({
  className = "",
  children,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  // Determine background style: disabled, gradient override, or default green
  const hasGradient = className.includes('bg-gradient-to-r');
  const defaultGradient = 'bg-gradient-to-r from-[#356E6A] to-[#73B9A3] hover:from-[#2a5956] hover:to-[#5fa88d] text-white';
  const baseStyle = disabled
    ? 'bg-transparent text-[#356E6A] cursor-not-allowed border border-[#356E6A]'
    : hasGradient
    ? 'text-white'
    : defaultGradient;
  return (
    <button
      disabled={disabled}
      className={`${baseStyle} text-xl font-medium rounded-xl px-4 py-2 transition ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
