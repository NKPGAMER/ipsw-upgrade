import { type ReactNode } from "react";

interface ContentAreaProps {
  children: ReactNode;
}

export function ContentArea({ children }: ContentAreaProps) {
  return (
    <div className="flex-1 min-w-0 relative overflow-hidden bg-apple-tile-3">
      {children}
    </div>
  );
}
