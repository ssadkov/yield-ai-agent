/** SSR-safe placeholder while AgentHome mounts on the client (avoids wallet hydration mismatch). */
export function AgentHomeSkeleton() {
  return (
    <div className="flex min-h-dvh flex-col" aria-busy="true" aria-label="Loading Yield AI Agent">
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center justify-between gap-3 px-4 sm:px-5">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-xl bg-muted" />
            <div className="h-4 w-24 rounded bg-muted" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-full bg-muted" />
            <div className="h-9 w-28 rounded-full bg-muted" />
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-3 pt-3 sm:px-4 lg:pt-4">
        <div className="min-h-[calc(100dvh-5rem)] rounded-2xl border border-border/60 bg-surface/40" />
      </main>
    </div>
  );
}
