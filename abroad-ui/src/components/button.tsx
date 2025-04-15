import React from "react";

export function Button({
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`bg-green-600 hover:bg-green-700 text-white font-medium rounded-md px-4 py-2 transition ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
