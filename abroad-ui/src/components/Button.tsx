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
    ? 'bg-transparent !text-gray-400 cursor-not-allowed border border-[#356E6A]' // Ensure grey text when disabled
    : hasGradient
    ? 'text-gray-500'
    : defaultGradient;
  return (
    <button
      disabled={disabled}
      className={`${baseStyle} pointer-cursor text-xl font-medium rounded-xl px-4 py-2 transition ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
