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
  panelSolanaRpc,
  parseUsdc,
  readSolanaSafe,
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
  "inline-flex h-11 items-center justify-center rounded-full px-5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50";

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
  const [connection, setConnection] = useState<Connection | null>(null);
  useEffect(() => {
    setHost(window.location.host);
    setConnection(new Connection(panelSolanaRpc(window.location.host, window.location.origin), "confirmed"));
  }, []);

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
    if (!owner || !connection) return;
    setSafeError(null);
    try {
      setSafe(await readSolanaSafe(connection, new PublicKey(owner)));
    } catch (e) {
      setSafeError(`Solana RPC: ${errorText(e)}`);
    }
    if (aptos?.production) {
      aptosUsdcRaw(aptos.production).then(setAptosBalance).catch(() => setAptosBalance(null));
    }
  }, [owner, connection, aptos?.production]);

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
        if (!connection || !owner) return null;
        return (await readSolanaSafe(connection, new PublicKey(owner))).safeUsdcRaw;
      } catch {
        return null;
      }
    },
    [connection, owner]
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
    if (!owner || !connection || !quote || !recipient || amountRaw === null) return;
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
      const tx = await buildUsdcDepositTx(connection, new PublicKey(owner), depositKey, amountRaw);
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

  return (
    <section aria-label="Deposit test" className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">Deposit test · NEAR Intents 1-Click</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Sends USDC from this Solana wallet to a one-time 1-Click deposit address. 1-Click pays USDC to the
          destination below. Mainnet, real money: 1 to 5 USDC. If the swap does not complete, 1-Click refunds this
          wallet.
        </p>
      </div>

      <fieldset className="border-b border-border px-5 py-4">
        <legend className="text-sm font-semibold">Destination</legend>
        <label className="mt-3 flex items-start gap-3">
          <input
            type="radio"
            name="destination"
            className="mt-1"
            checked={destination === "solana-safe"}
            onChange={() => setDestination("solana-safe")}
          />
          <span className="text-sm leading-6">
            <span className="font-medium">Solana Safe</span>
            {safe ? (
              <span className="block text-muted-foreground">
                Recipient: Safe <span className="font-mono">{shorten(safe.safe.toBase58())}</span>. 1-Click pays into its
                USDC account <span className="font-mono">{shorten(safe.safeUsdcAta.toBase58())}</span>
                {safe.safeExists ? ` (now ${formatUsdc(safe.safeUsdcRaw)} USDC).` : ". No Safe on-chain yet."}
              </span>
            ) : null}
          </span>
        </label>
        <label className="mt-3 flex items-start gap-3">
          <input
            type="radio"
            name="destination"
            className="mt-1"
            checked={destination === "aptos"}
            onChange={() => setDestination("aptos")}
          />
          <span className="text-sm leading-6">
            <span className="font-medium">Aptos account (derived)</span>
            {aptos?.production ? (
              <span className="block text-muted-foreground">
                Recipient: <span className="break-all font-mono">{aptos.production}</span>, your derived account on{" "}
                {PRODUCTION_HOST}
                {aptosBalance !== null ? ` (now ${formatUsdc(aptosBalance)} USDC)` : ""}. Move it into the Aptos Safe
                from {PRODUCTION_HOST} afterwards.
              </span>
            ) : null}
            <span className="mt-1 block text-xs text-muted-foreground">
              {aptos?.formulaVerified
                ? `Address check passed: the formula reproduces the connected address for ${host}. Compare ${shorten(
                    aptos.production ?? ""
                  )} once with the address ${PRODUCTION_HOST} shows.`
                : aptosIsDerived
                  ? "Address check failed: the computed address for this host does not match the connected one."
                  : "Needs a Solana wallet connected as a derived Aptos account."}
            </span>
          </span>
        </label>
      </fieldset>

      <div className="border-b border-border px-5 py-4">
        <label className="block text-sm font-semibold" htmlFor="intents-amount">
          Amount, USDC on Solana
        </label>
        <div className="mt-2 flex gap-3">
          <input
            id="intents-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-11 w-32 rounded-full border border-border bg-background px-4 font-mono text-sm"
          />
          <button
            type="button"
            onClick={() => void getQuote()}
            disabled={blocker !== null || busy !== null}
            className={`${buttonClass} border border-border hover:bg-muted`}
          >
            {busy === "quote" ? "Quoting…" : "Get quote"}
          </button>
          <button
            type="button"
            onClick={() => void refreshBalances()}
            className={`${buttonClass} text-muted-foreground hover:bg-muted`}
          >
            Refresh
          </button>
        </div>
        {blocker ? <p className="mt-3 text-sm text-muted-foreground">{blocker}</p> : null}
        {safe ? (
          <p className="mt-2 text-xs text-muted-foreground">Wallet USDC on Solana: {formatUsdc(safe.walletUsdcRaw)}</p>
        ) : null}
      </div>

      {quote && quoteFresh ? (
        <div className="border-b border-border px-5 py-4 text-sm leading-6">
          <h3 className="font-semibold">Quote</h3>
          <p>
            You send {quote.response.quote.amountInFormatted} USDC, the destination gets about{" "}
            {quote.response.quote.amountOutFormatted} USDC (at least {formatUsdc(BigInt(quote.response.quote.minAmountOut))}
            ), in about {quote.response.quote.timeEstimate ?? "?"} s.
          </p>
          <p className="text-muted-foreground">
            Deposit address <span className="font-mono">{shorten(quote.response.quote.depositAddress ?? "")}</span>
            {quote.response.quote.deadline ? `, valid until ${new Date(quote.response.quote.deadline).toLocaleTimeString()}` : ""}.
            Recipient <span className="font-mono">{shorten(recipient ?? "")}</span>, refunds to this wallet.
          </p>
          <button
            type="button"
            onClick={() => void send()}
            disabled={blocker !== null || busy !== null}
            className={`${buttonClass} mt-3 bg-primary text-primary-foreground hover:opacity-90`}
          >
            {busy === "sign" ? "Confirm in the wallet…" : `Send ${quote.response.quote.amountInFormatted} USDC`}
          </button>
        </div>
      ) : null}

      {tracked ? (
        <div className="border-b border-border px-5 py-4 text-sm leading-6">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-semibold">Deposit</h3>
            <p className="font-mono text-xs">{status ? String(status.status) : "Waiting for status…"}</p>
          </div>
          <p className="text-muted-foreground">
            {formatUsdc(BigInt(tracked.amountRaw))} USDC to{" "}
            {tracked.destination === "solana-safe" ? "Solana Safe" : "Aptos account"}{" "}
            <span className="font-mono">{shorten(tracked.recipient)}</span>. Sent in{" "}
            <a className={linkClass} href={`https://solscan.io/tx/${tracked.txSig}`} target="_blank" rel="noopener noreferrer">
              {shorten(tracked.txSig)}
            </a>
            .
          </p>
          {status?.swapDetails?.destinationChainTxHashes?.map((tx) => (
            <p key={tx.hash}>
              Payout:{" "}
              <a
                className={linkClass}
                href={tx.explorerUrl ?? (tracked.destination === "aptos" ? `https://explorer.aptoslabs.com/txn/${tx.hash}?network=mainnet` : `https://solscan.io/tx/${tx.hash}`)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {shorten(tx.hash)}
              </a>
            </p>
          ))}
          {finalStatus === "SUCCESS" && delta !== null ? (
            <p className={delta > BigInt(0) ? "text-success" : "text-danger"}>
              Recipient balance changed by {delta >= BigInt(0) ? "+" : ""}
              {formatUsdc(delta < BigInt(0) ? -delta : delta)} USDC
              {delta > BigInt(0) ? "." : ". Check the payout transaction: the funds did not reach the expected account."}
            </p>
          ) : null}
          {finalStatus === "REFUNDED" || finalStatus === "FAILED" ? (
            <p className="text-danger">
              {finalStatus}
              {status?.swapDetails?.refundReason ? `: ${status.swapDetails.refundReason}` : ""}
              {status?.swapDetails?.refundedAmountFormatted ? `, refunded ${status.swapDetails.refundedAmountFormatted} USDC` : ""}.
            </p>
          ) : null}
          {finalStatus ? (
            <button type="button" onClick={clearTracked} className={`${buttonClass} mt-3 border border-border hover:bg-muted`}>
              Done
            </button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="px-5 py-4 text-sm text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
