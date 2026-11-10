"use client";

import { useTheme } from "@/lib/theme";

export function ThemeToggle() {
  const { theme, toggleTheme, ready } = useTheme();
  const isDark = theme === "dark";

  const label = !ready ? "Theme" : isDark ? "Switch to light theme" : "Switch to dark theme";
  const title = !ready ? "Theme" : isDark ? "Light" : "Dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={title}
      suppressHydrationWarning
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/80 bg-surface text-foreground transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {!ready ? (
        <span className="h-3.5 w-3.5 rounded-full bg-muted-foreground/30" aria-hidden />
      ) : isDark ? (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.75" />
          <path
            d="M12 3v2.2M12 18.8V21M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M3 12h2.2M18.8 12H21M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
          <path
            d="M20 14.5A7.5 7.5 0 0 1 9.5 4 7.6 7.6 0 1 0 20 14.5Z"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
