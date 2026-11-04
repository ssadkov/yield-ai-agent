/**
 * The Yield AI Solana Safe (program yie1…, repo ssadkov/yield-ai-os-sol): a PDA
 * ["vault", owner] that holds a USDC associated token account (ATA).
 *
 * 1-Click treats `recipient` as a wallet and pays into ATA(recipient, USDC). So the
 * recipient for a Safe deposit is the Safe PDA. Passing the ATA itself would make the
 * solver create an "ATA of the ATA" that nobody can sign for (a dry quote on
 * 2026-11-04 priced that path $0.25 lower: it budgets the account rent).
 *
 * Instructions are built by hand to avoid adding @solana/spl-token.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type Commitment,
} from "@solana/web3.js";

export const SAFE_PROGRAM_ID = new PublicKey("yie1Jjq6y3rjsiGkgMYnwTveSgpSrSh4n41JHRNyBih");
export const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const USDC_DECIMALS = 6;
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");

export function safeAddress(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), owner.toBuffer()], SAFE_PROGRAM_ID)[0];
}

export function usdcAta(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), USDC_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

/** Raw amount from an SPL token account (165-byte layout, amount at offset 64). */
function tokenAmount(data: Uint8Array): bigint {
  return Buffer.from(data).readBigUInt64LE(64);
}

export type SolanaSafeState = {
  safe: PublicKey;
  safeUsdcAta: PublicKey;
  safeExists: boolean;
  safeUsdcAtaExists: boolean;
  safeUsdcRaw: bigint;
  walletUsdcRaw: bigint;
};

export async function readSolanaSafe(
  connection: Connection,
  owner: PublicKey,
  commitment: Commitment = "confirmed"
): Promise<SolanaSafeState> {
  const safe = safeAddress(owner);
  const safeUsdcAta = usdcAta(safe);
  const walletAta = usdcAta(owner);
  const [safeInfo, safeAtaInfo, walletAtaInfo] = await connection.getMultipleAccountsInfo(
    [safe, safeUsdcAta, walletAta],
    commitment
  );
  const isTokenAccount = (info: typeof safeAtaInfo) =>
    info !== null && info.owner.equals(TOKEN_PROGRAM_ID) && info.data.length >= 72;
  return {
    safe,
    safeUsdcAta,
    safeExists: safeInfo !== null && safeInfo.owner.equals(SAFE_PROGRAM_ID),
    safeUsdcAtaExists: isTokenAccount(safeAtaInfo),
    safeUsdcRaw: isTokenAccount(safeAtaInfo) ? tokenAmount(safeAtaInfo!.data) : BigInt(0),
    walletUsdcRaw: isTokenAccount(walletAtaInfo) ? tokenAmount(walletAtaInfo!.data) : BigInt(0),
  };
}

/** ATA program CreateIdempotent (instruction 1). */
function createAtaIdempotent(payer: PublicKey, ata: PublicKey, owner: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

/** SPL Token TransferChecked (instruction 12): amount u64 LE, decimals u8. */
function transferChecked(source: PublicKey, destination: PublicKey, owner: PublicKey, amount: bigint): TransactionInstruction {
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0);
  data.writeBigUInt64LE(amount, 1);
  data.writeUInt8(USDC_DECIMALS, 9);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

/**
 * USDC from the connected wallet to the 1-Click deposit address. The deposit address is a
 * wallet: send to its USDC ATA, created idempotently (the sender pays ~0.002 SOL rent if missing).
 */
export async function buildUsdcDepositTx(
  connection: Connection,
  from: PublicKey,
  depositAddress: PublicKey,
  amountRaw: bigint
): Promise<Transaction> {
  const destinationAta = usdcAta(depositAddress);
  const tx = new Transaction().add(
    createAtaIdempotent(from, destinationAta, depositAddress),
    transferChecked(usdcAta(from), destinationAta, from, amountRaw)
  );
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = from;
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  return tx;
}

const PUBLICNODE_RPC = "https://solana-rpc.publicnode.com";

/**
 * RPC endpoints for this panel, in order of preference. On yieldai.app the main app
 * proxies Solana RPC same-origin at /api/solana/rpc (it rejects other origins); its
 * upstream key is shared by the whole site and can answer 429, so PublicNode is the
 * fallback. Elsewhere the public api.mainnet-beta endpoint answers browsers with 403
 * (checked 2026-11-04), so PublicNode is the only one.
 */
export function panelSolanaRpcs(host: string, origin: string): string[] {
  return host.toLowerCase() === "yieldai.app" ? [`${origin}/api/solana/rpc`, PUBLICNODE_RPC] : [PUBLICNODE_RPC];
}

/**
 * No silent web3.js retry on 429: it waits ~8 s per endpoint before failing. Fail fast and
 * let `withFallback` try the next endpoint instead.
 */
export function panelConnections(host: string, origin: string): Connection[] {
  return panelSolanaRpcs(host, origin).map(
    (url) => new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true })
  );
}

/** Runs `fn` against each connection in turn; returns the first success. */
export async function withFallback<T>(
  connections: Connection[],
  fn: (connection: Connection) => Promise<T>
): Promise<{ value: T; connection: Connection }> {
  const errors: string[] = [];
  for (const connection of connections) {
    try {
      return { value: await fn(connection), connection };
    } catch (error) {
      const host = (() => {
        try {
          return new URL(connection.rpcEndpoint).host;
        } catch {
          return connection.rpcEndpoint;
        }
      })();
      errors.push(`${host}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(errors.join("; ") || "No Solana RPC endpoint");
}

export function formatUsdc(raw: bigint): string {
  const whole = raw / BigInt(10 ** USDC_DECIMALS);
  const fraction = (raw % BigInt(10 ** USDC_DECIMALS)).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Decimal USDC string to raw units. Returns null for anything that is not a plain positive number. */
export function parseUsdc(input: string): bigint | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  const raw = BigInt(whole) * BigInt(10 ** USDC_DECIMALS) + BigInt(fraction.padEnd(USDC_DECIMALS, "0"));
  return raw > BigInt(0) ? raw : null;
}
