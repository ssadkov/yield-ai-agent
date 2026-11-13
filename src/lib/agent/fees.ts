/**
 * Performance fee of the Safe program, in basis points of the gain on a Kamino exit.
 * On chain: 2000 since 2026-11-12. A signed-in user's own figure is read from the program's
 * config (safeSummary.server.ts); this constant is for text shown before any Safe is read.
 */
export const SAFE_PERFORMANCE_FEE_BPS = 2000;

export const SAFE_PERFORMANCE_FEE_PCT = SAFE_PERFORMANCE_FEE_BPS / 100;
