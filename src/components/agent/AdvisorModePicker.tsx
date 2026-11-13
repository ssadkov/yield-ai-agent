"use client";

import { useEffect, useRef, useState } from "react";
import {
  CHAT_MODES,
  CHAT_MODE_HINT,
  CHAT_MODE_LABEL,
  OPEN_CHAT_LOCKED_HINT,
  type ChatMode,
} from "@/lib/advisor/modes";

export function AdvisorModePicker({
  value,
  disabled,
  openChatUnlocked,
  onChange,
}: {
  value: ChatMode;
  disabled?: boolean;
  /** Open chat is shown but cannot be picked until the wallet deposited or bought credits. */
  openChatUnlocked: boolean;
  onChange: (mode: ChatMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Chat mode"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-8 max-w-[9rem] items-center gap-1.5 rounded-full border border-border/70 bg-background/80 px-2.5 text-[12.5px] font-medium tracking-tight text-foreground/85 transition-colors hover:border-foreground/20 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
      >
        <span className="truncate">{CHAT_MODE_LABEL[value]}</span>
        <svg
          viewBox="0 0 24 24"
          className={["h-3 w-3 shrink-0 text-muted-foreground transition-transform", open ? "rotate-180" : ""].join(" ")}
          fill="none"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Chat modes"
          className="panel-popover absolute bottom-[calc(100%+0.5rem)] left-0 z-30 w-[min(17.5rem,calc(100vw-2.5rem))] overflow-hidden rounded-2xl p-1.5 shadow-lg"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[11.5px] font-medium tracking-wide text-muted-foreground uppercase">
            Mode
          </p>
          <div className="space-y-0.5">
            {CHAT_MODES.map((item) => {
              const selected = item === value;
              const locked = item === "free" && !openChatUnlocked;
              return (
                <button
                  key={item}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-disabled={locked}
                  onClick={() => {
                    if (locked) return;
                    onChange(item);
                    setOpen(false);
                  }}
                  className={[
                    "flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "bg-muted" : locked ? "cursor-not-allowed opacity-60" : "hover:bg-muted/70",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                      selected ? "border-foreground bg-foreground text-background" : "border-border",
                    ].join(" ")}
                    aria-hidden
                  >
                    {selected ? (
                      <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none">
                        <path
                          d="M5 12.5l4.2 4.2L19 7"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-medium tracking-tight text-foreground">
                      {CHAT_MODE_LABEL[item]}
                      {locked ? <span aria-hidden> 🔒</span> : null}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">
                      {locked ? OPEN_CHAT_LOCKED_HINT : CHAT_MODE_HINT[item]}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
