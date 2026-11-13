"use client";

import { useEffect, useState } from "react";

/** Enough decimals for the last digit to move about five times a second, at most four. */
export function tickDecimals(perSecond: number): number {
  if (!(perSecond > 0)) return 0;
  return Math.min(4, Math.max(0, Math.ceil(-Math.log10(perSecond * 0.2))));
}

/**
 * A number that keeps growing at a known rate between server reads: `base` at `since` (ms),
 * plus `perSecond` for every second after. It is an estimate until the next read replaces `base`.
 */
export function TickingNumber({
  base,
  perSecond,
  since,
  className,
}: {
  base: number;
  perSecond: number;
  since: number;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!(perSecond > 0)) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [perSecond]);
  const value = base + perSecond * Math.max(0, (now - since) / 1000);
  const decimals = tickDecimals(perSecond);
  return (
    <span className={["tabular-nums", className].filter(Boolean).join(" ")}>
      {value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
    </span>
  );
}
