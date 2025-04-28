import React, { MouseEventHandler, ReactNode } from "react";

interface CardProps {
  className?: string;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLDivElement>;
}

export function Card({ className = "", children, onClick }: CardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`bg-white border rounded-lg ${className}`}
      onClick={onClick}
      onKeyDown={e => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick(e as unknown as React.MouseEvent<HTMLDivElement>);
        }
      }}
    >
      {children}
    </div>
  );
}

export function CardContent({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}
