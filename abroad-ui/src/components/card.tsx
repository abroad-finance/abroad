import React, { MouseEventHandler, ReactNode } from "react";

interface CardProps {
  className?: string;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLDivElement>;
}

export function Card({ className = "", children, onClick }: CardProps) {
  return (
    <div className={`bg-white border rounded-lg ${className}`} onClick={onClick}>
      {children}
    </div>
  );
}

export function CardContent({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}
