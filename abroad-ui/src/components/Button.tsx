import React from "react";

export function Button({
  className = "",
  children,
  disabled,
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  const baseStyle = disabled
    ? 'bg-transparent text-[#356E6A] cursor-not-allowed border border-[#356E6A]'
    : active
    ? 'bg-gradient-to-r from-[#356E6A] to-[#73B9A3] text-white'
    : 'bg-transparent border border-gray-200 hover:shadow-md hover:bg-gradient-to-r hover:from-[#356E6A] hover:to-[#73B9A3] hover:text-white';

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
