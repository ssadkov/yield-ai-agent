"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  ASSET_APTOS_USDC,
  ASSET_SOLANA_USDC,
  FINAL_STATUSES,
  fetchStatus,
  requestQuote,
  submitDepositTx,
  type OneClickQuoteResponse,
  type OneClickStatusResponse,
} from "@/lib/agent/oneClick";
import {
  buildUsdcDepositTx,
  formatUsdc,
  panelConnections,
  parseUsdc,
  readSolanaSafe,
  safeAddress,
  usdcAta,
  withFallback,
  type SolanaSafeState,
} from "@/lib/agent/solanaSafe";
import {
  PRODUCTION_HOST,
  aptosUsdcRaw,
  derivedAptosAddress,
  sameAptosAddress,
} from "@/lib/agent/aptosDerived";

/** Test-sized deposits only, while the flow is unproven on mainnet. */
const MIN_RAW = BigInt(1_000_000);
const MAX_RAW = BigInt(5_000_000);
const SLIPPAGE_BPS = 100;
const POLL_MS = 5_000;
const QUOTE_MAX_AGE_MS = 10 * 60 * 1000;
const STORAGE_KEY = "agent.intents.lastDeposit.v1";
const OPEN_KEY = "agent.intents.panelOpen.v1";

type Destination = "solana-safe" | "aptos";

type Tracked = {
  solanaOwner: string;
  destination: Destination;
  recipient: string;
  depositAddress: string;
  txSig: string;
  amountRaw: string;
  recipientBeforeRaw: string;
  startedAt: number;
};

function shorten(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}

function loadTracked(): Tracked | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Tracked) : null;
  } catch {
    return null;
  }
}

function saveTracked(value: Tracked | null) {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode: tracking just does not survive a reload */
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

const linkClass =
  "underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const buttonClass =
  "inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50";

function loadPanelOpen(): boolean {
  try {
    const raw = window.localStorage.getItem(OPEN_KEY);
    if (raw === null) return true;
    return raw === "1";
  } catch {
    return true;
  }
}

export function IntentsDepositPanel({
  aptosAddress,
  aptosIsDerived,
}: {
  aptosAddress: string | null;
  aptosIsDerived: boolean;
}) {
  const { publicKey, connected, sendTransaction } = useWallet();
  const owner = connected && publicKey ? publicKey.toBase58() : null;
  const [host, setHost] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [open, setOpen] = useState(true);
  const [openReady, setOpenReady] = useState(false);
  useEffect(() => {
    setHost(window.location.host);
    setConnections(panelConnections(window.location.host, window.location.origin));
    setOpen(loadPanelOpen());
    setOpenReady(true);
  }, []);
  useEffect(() => {
    if (!openReady) return;
    try {
      window.localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open, openReady]);
  // The Safe address needs no RPC: show it even when reads fail.
  const derivedSafe = useMemo(() => {
    if (!owner) return null;
    const safe = safeAddress(new PublicKey(owner));
    return { safe, ata: usdcAta(safe) };
  }, [owner]);

  const [destination, setDestination] = useState<Destination>("solana-safe");
  const [amount, setAmount] = useState("1");
  const [safe, setSafe] = useState<SolanaSafeState | null>(null);
  const [safeError, setSafeError] = useState<string | null>(null);
  const [aptosBalance, setAptosBalance] = useState<bigint | null>(null);
  const [quote, setQuote] = useState<{ response: OneClickQuoteResponse; at: number; key: string } | null>(null);
  const [busy, setBusy] = useState<null | "quote" | "sign">(null);
  const [error, setError] = useState<string | null>(null);
  const [tracked, setTracked] = useState<Tracked | null>(null);
  const [status, setStatus] = useState<OneClickStatusResponse | null>(null);
  const [recipientAfterRaw, setRecipientAfterRaw] = useState<bigint | null>(null);
  const pollTimer = useRef<number | null>(null);

  // Aptos: trust the production address only if the same formula reproduces the
  // address the wallet connected with on this host.
  const aptos = useMemo(() => {
    if (!owner || !host) return null;
    try {
      const forThisHost = derivedAptosAddress(owner, host);
      const production = derivedAptosAddress(owner, PRODUCTION_HOST);
      const formulaVerified = aptosIsDerived && sameAptosAddress(forThisHost, aptosAddress);
      return { forThisHost, production, formulaVerified };
    } catch (e) {
      return { forThisHost: null, production: null, formulaVerified: false, error: errorText(e) };
    }
  }, [owner, host, aptosAddress, aptosIsDerived]);

  const refreshBalances = useCallback(async () => {
    if (!owner || connections.length === 0) return;
    setSafeError(null);
    try {
      setSafe((await withFallback(connections, (c) => readSolanaSafe(c, new PublicKey(owner)))).value);
    } catch (e) {
      setSafeError(`Solana RPC is busy, press Refresh. (${errorText(e)})`);
    }
    if (aptos?.production) {
      aptosUsdcRaw(aptos.production).then(setAptosBalance).catch(() => setAptosBalance(null));
    }
  }, [owner, connections, aptos?.production]);

  useEffect(() => {
    void refreshBalances();
  }, [refreshBalances]);

  const amountRaw = parseUsdc(amount);
  const recipient =
    destination === "solana-safe" ? safe?.safe.toBase58() ?? null : aptos?.formulaVerified ? aptos.production : null;
  const destinationAsset = destination === "solana-safe" ? ASSET_SOLANA_USDC : ASSET_APTOS_USDC;
  const quoteKey = `${destination}|${recipient}|${amountRaw}|${owner}`;
  const quoteFresh = quote !== null && quote.key === quoteKey && Date.now() - quote.at < QUOTE_MAX_AGE_MS;

  const blocker = (() => {
    if (!owner) return "Connect the Solana wallet in this browser first.";
    if (amountRaw === null) return "Enter a USDC amount, up to 6 decimals.";
    if (amountRaw < MIN_RAW || amountRaw > MAX_RAW) return "Test amounts only: 1 to 5 USDC.";
    if (!safe) return safeError ?? "Reading the wallet…";
    if (safe.walletUsdcRaw < amountRaw) return `This wallet holds ${formatUsdc(safe.walletUsdcRaw)} USDC on Solana.`;
    if (destination === "solana-safe") {
      if (!safe.safeExists) return "This wallet has no Solana Safe yet. Create it in the Yield AI Solana app first.";
      if (!safe.safeUsdcAtaExists) return "The Safe has no USDC account yet. Re-open it in the Safe app so it is created.";
    } else if (!aptos?.formulaVerified) {
      return "The derived Aptos address could not be verified on this host, so the Aptos route is off.";
    }
    if (tracked && !FINAL_STATUSES.has(String(status?.status ?? ""))) return "A deposit is still in progress below.";
    return null;
  })();

  const getQuote = async () => {
    if (!owner || !recipient || amountRaw === null) return;
    setBusy("quote");
    setError(null);
    try {
      const response = await requestQuote({
        amountRaw: amountRaw.toString(),
        destinationAsset,
        recipient,
        refundTo: owner,
        slippageBps: SLIPPAGE_BPS,
        dry: false,
      });
      setQuote({ response, at: Date.now(), key: quoteKey });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const stopPolling = () => {
    if (pollTimer.current !== null) window.clearTimeout(pollTimer.current);
    pollTimer.current = null;
  };

  const readRecipientRaw = useCallback(
    async (t: Pick<Tracked, "destination" | "recipient">): Promise<bigint | null> => {
      try {
        if (t.destination === "aptos") return await aptosUsdcRaw(t.recipient);
        if (connections.length === 0 || !owner) return null;
        return (await withFallback(connections, (c) => readSolanaSafe(c, new PublicKey(owner)))).value.safeUsdcRaw;
      } catch {
        return null;
      }
    },
    [connections, owner]
  );

  const poll = useCallback(
    (t: Tracked) => {
      stopPolling();
      const tick = async () => {
        try {
          const next = await fetchStatus(t.depositAddress);
          setStatus(next);
          if (FINAL_STATUSES.has(String(next.status))) {
            setRecipientAfterRaw(await readRecipientRaw(t));
            void refreshBalances();
            return;
          }
        } catch (e) {
          setError(`Status: ${errorText(e)}`);
        }
        pollTimer.current = window.setTimeout(tick, POLL_MS);
      };
      void tick();
    },
    [readRecipientRaw, refreshBalances]
  );

  // Resume tracking after a reload.
  useEffect(() => {
    if (!owner) return;
    const saved = loadTracked();
    if (saved && saved.solanaOwner === owner) {
      setTracked(saved);
      poll(saved);
    }
    return stopPolling;
  }, [owner, poll]);

  const send = async () => {
    if (!owner || connections.length === 0 || !quote || !recipient || amountRaw === null) return;
    const q = quote.response;
    const depositAddress = q.quote.depositAddress;
    setError(null);
    // The API echoes the request it priced; refuse to send if any of it differs.
    const echoed = (q as unknown as { quoteRequest?: Record<string, unknown> }).quoteRequest ?? {};
    if (
      !depositAddress ||
      echoed.recipient !== recipient ||
      echoed.refundTo !== owner ||
      echoed.destinationAsset !== destinationAsset ||
      echoed.originAsset !== ASSET_SOLANA_USDC ||
      String(echoed.amount) !== amountRaw.toString()
    ) {
      setError("The quote does not match what was requested. Get a new quote.");
      return;
    }
    if (q.quote.deadline && Date.parse(q.quote.deadline) < Date.now() + 5 * 60 * 1000) {
      setError("The quote expires within 5 minutes. Get a new quote.");
      return;
    }
    let depositKey: PublicKey;
    try {
      depositKey = new PublicKey(depositAddress);
    } catch {
      setError("1-Click returned an invalid Solana deposit address.");
      return;
    }
    setBusy("sign");
    try {
      const before = (await readRecipientRaw({ destination, recipient })) ?? BigInt(0);
      const { value: tx, connection } = await withFallback(connections, (c) =>
        buildUsdcDepositTx(c, new PublicKey(owner), depositKey, amountRaw)
      );
      const txSig = await sendTransaction(tx, connection);
      const next: Tracked = {
        solanaOwner: owner,
        destination,
        recipient,
        depositAddress,
        txSig,
        amountRaw: amountRaw.toString(),
        recipientBeforeRaw: before.toString(),
        startedAt: Date.now(),
      };
      saveTracked(next);
      setTracked(next);
      setStatus(null);
      setRecipientAfterRaw(null);
      setQuote(null);
      submitDepositTx(txSig, depositAddress).catch(() => undefined);
      poll(next);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const clearTracked = () => {
    stopPolling();
    saveTracked(null);
    setTracked(null);
    setStatus(null);
    setRecipientAfterRaw(null);
  };

  const finalStatus = status && FINAL_STATUSES.has(String(status.status)) ? String(status.status) : null;
  const delta =
    tracked && recipientAfterRaw !== null ? recipientAfterRaw - BigInt(tracked.recipientBeforeRaw) : null;
  const balancesLoading = Boolean(owner && !safe && !safeError);
  const activeDeposit = Boolean(tracked && !finalStatus);

  useEffect(() => {
    if (activeDeposit || (quote && quoteFresh) || error) setOpen(true);
  }, [activeDeposit, quote, quoteFresh, error]);

  const collapsedSummary = tracked
    ? `${formatUsdc(BigInt(tracked.amountRaw))} USDC · ${status ? String(status.status) : "pending"}`
    : destination === "solana-safe"
      ? `Solana Safe · ${amount} USDC`
      : `Aptos · ${amount} USDC`;

  const solanaMeta = !derivedSafe
    ? null
    : safeError
      ? "Balance unavailable"
      : !safe
        ? "Reading…"
        : safe.safeExists
          ? `${formatUsdc(safe.safeUsdcRaw)} USDC`
          : "No Safe yet";

  if (!owner || connections.length === 0) {
    return (
      <section aria-label="Deposit loading" className="panel-glass overflow-hidden rounded-2xl px-4 py-3" aria-busy="true">
        <div className="h-2.5 w-20 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-4 w-36 animate-pulse rounded bg-muted" />
        <div className="mt-4 space-y-3">
          <div className="h-10 w-full animate-pulse rounded-xl bg-muted" />
          <div className="h-10 w-full animate-pulse rounded-xl bg-muted" />
          <div className="h-10 w-full animate-pulse rounded-full bg-muted" />
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Deposit test" className="panel-glass overflow-hidden rounded-2xl">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
            <path
              d="M4 8.5h16v9.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8.5Zm2.5-4h11L19 8.5H5l1.5-4Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M12 12.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight">Deposit</h2>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] tracking-wide text-primary">
              1-Click
            </span>
            {activeDeposit ? (
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" aria-hidden />
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {open ? "Mainnet USDC · 1–5 · refunds on fail" : collapsedSummary}
          </p>
        </div>
        <span
          className={[
            "mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-transform",
            open ? "rotate-180" : "",
          ].join(" ")}
          aria-hidden
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open ? (
        <div className="border-t border-border">
          <div className="space-y-3 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">Destination</p>
              <button
                type="button"
                onClick={() => void refreshBalances()}
                className="inline-flex h-7 items-center rounded-full px-2 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Refresh
              </button>
            </div>

            {balancesLoading ? (
              <div className="space-y-2" aria-busy="true" aria-label="Loading balances">
                <div className="h-14 w-full animate-pulse rounded-2xl bg-muted" />
                <div className="h-14 w-full animate-pulse rounded-2xl bg-muted" />
              </div>
            ) : (
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => setDestination("solana-safe")}
                  className={[
                    "rounded-2xl border px-3 py-2.5 text-left transition-colors",
                    destination === "solana-safe"
                      ? "border-primary/40 bg-primary/5 shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_20%,transparent)]"
                      : "border-border/80 bg-surface hover:border-border hover:bg-muted/50",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">Solana Safe</span>
                    {destination === "solana-safe" ? (
                      <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
                    ) : null}
                  </div>
                  {derivedSafe ? (
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {shorten(derivedSafe.safe.toBase58())}
                      {solanaMeta ? ` · ${solanaMeta}` : ""}
                    </p>
                  ) : null}
                </button>

                <button
                  type="button"
                  disabled={!aptos?.formulaVerified}
                  onClick={() => setDestination("aptos")}
                  className={[
                    "rounded-2xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    destination === "aptos"
                      ? "border-primary/40 bg-primary/5 shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_20%,transparent)]"
                      : "border-border/80 bg-surface hover:border-border hover:bg-muted/50",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">Aptos</span>
                    {destination === "aptos" ? (
                      <span className="h-2 w-2 rounded-full bg-primary" aria-hidden />
                    ) : null}
                  </div>
                  {aptos?.formulaVerified && aptos.production ? (
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {shorten(aptos.production)}
                      {aptosBalance !== null ? ` · ${formatUsdc(aptosBalance)} USDC` : ""}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {aptosIsDerived ? "Unavailable on this host" : "Needs derived Solana wallet"}
                    </p>
                  )}
                </button>
              </div>
            )}
          </div>

          <div className="border-t border-border px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="intents-amount">
                Amount
              </label>
              {!balancesLoading && safe ? (
                <span className="text-[11px] text-muted-foreground">
                  Wallet {formatUsdc(safe.walletUsdcRaw)} USDC
                </span>
              ) : null}
            </div>

            {balancesLoading ? (
              <div className="mt-2 space-y-2" aria-busy="true">
                <div className="h-11 w-full animate-pulse rounded-2xl bg-muted" />
                <div className="h-8 w-full animate-pulse rounded-full bg-muted" />
              </div>
            ) : (
              <>
                <div className="relative mt-2">
                  <input
                    id="intents-amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="h-11 w-full rounded-2xl border border-border bg-background px-3 pr-14 font-mono text-sm outline-none focus:border-primary/40 focus:shadow-[0_0_0_3px_var(--glow)]"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-muted-foreground">
                    USDC
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void getQuote()}
                  disabled={blocker !== null || busy !== null}
                  className={`${buttonClass} mt-3 w-full bg-primary text-primary-foreground hover:opacity-90`}
                >
                  {busy === "quote" ? "Getting quote…" : "Get quote"}
                </button>
                {blocker ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{blocker}</p> : null}
              </>
            )}
          </div>

          {quote && quoteFresh ? (
            <div className="border-t border-border px-4 py-3">
              <div className="rounded-2xl border border-border/70 bg-surface px-3 py-3">
                <p className="text-xs font-medium text-muted-foreground">Quote</p>
                <p className="mt-1 text-sm font-semibold tracking-tight">
                  {quote.response.quote.amountInFormatted} → ~{quote.response.quote.amountOutFormatted} USDC
                </p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  Min {formatUsdc(BigInt(quote.response.quote.minAmountOut))} · ~
                  {quote.response.quote.timeEstimate ?? "?"}s
                  {quote.response.quote.deadline
                    ? ` · until ${new Date(quote.response.quote.deadline).toLocaleTimeString()}`
                    : ""}
                </p>
                <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                  To {shorten(recipient ?? "")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void send()}
                disabled={blocker !== null || busy !== null}
                className={`${buttonClass} mt-3 w-full bg-foreground text-background hover:opacity-90`}
              >
                {busy === "sign" ? "Confirm in wallet…" : `Send ${quote.response.quote.amountInFormatted} USDC`}
              </button>
            </div>
          ) : null}

          {tracked ? (
            <div className="border-t border-border px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">Status</p>
                <p className="font-mono text-[11px] text-foreground/80">
                  {status ? String(status.status) : "Waiting…"}
                </p>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {formatUsdc(BigInt(tracked.amountRaw))} USDC →{" "}
                {tracked.destination === "solana-safe" ? "Solana Safe" : "Aptos"}{" "}
                <span className="font-mono">{shorten(tracked.recipient)}</span>
              </p>
              <a
                className={`${linkClass} mt-1 inline-block text-xs`}
                href={`https://solscan.io/tx/${tracked.txSig}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Tx {shorten(tracked.txSig)}
              </a>
              {status?.swapDetails?.destinationChainTxHashes?.map((tx) => (
                <p key={tx.hash} className="mt-1 text-xs">
                  Payout{" "}
                  <a
                    className={linkClass}
                    href={
                      tx.explorerUrl ??
                      (tracked.destination === "aptos"
                        ? `https://explorer.aptoslabs.com/txn/${tx.hash}?network=mainnet`
                        : `https://solscan.io/tx/${tx.hash}`)
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {shorten(tx.hash)}
                  </a>
                </p>
              ))}
              {finalStatus === "SUCCESS" && delta !== null ? (
                <p className={`mt-2 text-xs ${delta > BigInt(0) ? "text-foreground" : "text-danger"}`}>
                  Balance {delta >= BigInt(0) ? "+" : "-"}
                  {formatUsdc(delta < BigInt(0) ? -delta : delta)} USDC
                  {delta > BigInt(0) ? "" : " — check payout tx"}
                </p>
              ) : null}
              {finalStatus === "REFUNDED" || finalStatus === "FAILED" ? (
                <p className="mt-2 text-xs text-danger">
                  {finalStatus}
                  {status?.swapDetails?.refundReason ? `: ${status.swapDetails.refundReason}` : ""}
                  {status?.swapDetails?.refundedAmountFormatted
                    ? `, refunded ${status.swapDetails.refundedAmountFormatted} USDC`
                    : ""}
                </p>
              ) : null}
              {finalStatus ? (
                <button
                  type="button"
                  onClick={clearTracked}
                  className={`${buttonClass} mt-3 w-full border border-border hover:bg-muted`}
                >
                  Done
                </button>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="border-t border-border px-4 py-3 text-xs text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
