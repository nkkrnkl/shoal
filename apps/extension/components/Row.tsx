import type { ReactNode } from "react";

export type RowTone = "neutral" | "ok" | "signal";

export interface RowProps {
  title: string;
  /** One-line summary shown while collapsed. */
  value: string;
  tone?: RowTone;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/** A one-line summary that expands into details, built on <details> so it is keyboard and screen reader friendly. */
export function Row({ title, value, tone = "neutral", open, onOpenChange, children }: RowProps) {
  return (
    <details
      className="row"
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (next !== open) onOpenChange(next);
      }}
    >
      <summary>
        <span className="row-title">{title}</span>
        <span className="row-value" data-tone={tone}>
          {value}
        </span>
      </summary>
      <div className="row-body">{children}</div>
    </details>
  );
}
