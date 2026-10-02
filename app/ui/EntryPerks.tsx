import type { ReactNode } from "react";
import "./entry-perks.css";

export function EntryPerks({ count, children }: { count: number; children: ReactNode }) {
  if (!count) return null;
  return <details className="entry-perks">
    <summary>
      <span className="entry-perks-show">Show entry perks ({count})</span>
      <span className="entry-perks-hide">Hide entry perks ({count})</span>
      <small>Excluded from value totals</small>
    </summary>
    <div className="entry-perks-content">{children}</div>
  </details>;
}
