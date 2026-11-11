/**
 * Advisor credit ledger in Neon Postgres (`DATABASE_URL`, set by the Neon integration on Vercel).
 * Without `DATABASE_URL` credits are off: the proxy keeps working without a wallet session and
 * only the key's `spend_limit` caps spending.
 *
 * Holds no prompts or answers: wallets, NEAR AI inference ids with their cost, and 1-Click purchases.
 */
import { neon } from "@neondatabase/serverless";
import { monthKey, type MonthSpend } from "./ledger.ts";

type Sql = ReturnType<typeof neon>;

let sqlClient: Sql | null = null;
let schemaReady: Promise<void> | null = null;

export function creditsEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function sql(): Sql {
  if (!sqlClient) {
    const url = process.env.DATABASE_URL?.trim();
    if (!url) throw new Error("DATABASE_URL is not configured");
    sqlClient = neon(url);
  }
  return sqlClient;
}

async function ready(): Promise<Sql> {
  const db = sql();
  schemaReady ??= (async () => {
    await db`create table if not exists advisor_usage (
      inference_id text primary key,
      wallet text not null,
      estimated_usd numeric not null,
      cost_usd numeric,
      created_at timestamptz not null default now()
    )`;
    await db`create index if not exists advisor_usage_wallet on advisor_usage (wallet, created_at)`;
    await db`create table if not exists advisor_purchases (
      deposit_address text primary key,
      wallet text not null,
      amount_usd numeric not null,
      origin_asset text not null,
      amount_in text not null,
      deadline timestamptz,
      status text not null default 'PENDING_DEPOSIT',
      credited boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`;
    await db`create index if not exists advisor_purchases_wallet on advisor_purchases (wallet)`;
  })().catch((error) => {
    schemaReady = null;
    throw error;
  });
  await schemaReady;
  return db;
}

type Row = Record<string, unknown>;
const rows = (result: unknown) => result as Row[];

export async function recordUsage(wallet: string, inferenceId: string, estimatedUsd: number): Promise<void> {
  const db = await ready();
  await db`insert into advisor_usage (inference_id, wallet, estimated_usd)
           values (${inferenceId}, ${wallet}, ${estimatedUsd})
           on conflict (inference_id) do nothing`;
}

export async function spendByMonth(wallet: string): Promise<MonthSpend[]> {
  const db = await ready();
  const result = rows(
    await db`select to_char(date_trunc('month', created_at at time zone 'UTC'), 'YYYY-MM') as month,
                    sum(coalesce(cost_usd, estimated_usd)) as usd
             from advisor_usage where wallet = ${wallet} group by 1`
  );
  return result.map((r) => ({ month: String(r.month), usd: Number(r.usd) }));
}

export async function purchasedUsd(wallet: string): Promise<number> {
  const db = await ready();
  const [row] = rows(
    await db`select coalesce(sum(amount_usd), 0) as usd from advisor_purchases where wallet = ${wallet} and credited`
  );
  return Number(row?.usd ?? 0);
}

/** Usage rows still priced by estimate, oldest first, at least 20 s old so billing has them. */
export async function unpricedUsage(limit = 50): Promise<string[]> {
  const db = await ready();
  const result = rows(
    await db`select inference_id from advisor_usage
             where cost_usd is null and created_at < now() - interval '20 seconds'
             order by created_at limit ${limit}`
  );
  return result.map((r) => String(r.inference_id));
}

export async function setUsageCost(inferenceId: string, costUsd: number): Promise<void> {
  const db = await ready();
  await db`update advisor_usage set cost_usd = ${costUsd} where inference_id = ${inferenceId}`;
}

export type Purchase = {
  depositAddress: string;
  wallet: string;
  amountUsd: number;
  originAsset: string;
  amountIn: string;
  deadline: string | null;
  status: string;
  credited: boolean;
  createdAt: string;
};

function toPurchase(r: Row): Purchase {
  return {
    depositAddress: String(r.deposit_address),
    wallet: String(r.wallet),
    amountUsd: Number(r.amount_usd),
    originAsset: String(r.origin_asset),
    amountIn: String(r.amount_in),
    deadline: r.deadline ? new Date(String(r.deadline)).toISOString() : null,
    status: String(r.status),
    credited: Boolean(r.credited),
    createdAt: new Date(String(r.created_at)).toISOString(),
  };
}

export async function insertPurchase(p: Omit<Purchase, "status" | "credited" | "createdAt">): Promise<void> {
  const db = await ready();
  await db`insert into advisor_purchases (deposit_address, wallet, amount_usd, origin_asset, amount_in, deadline)
           values (${p.depositAddress}, ${p.wallet}, ${p.amountUsd}, ${p.originAsset}, ${p.amountIn}, ${p.deadline})`;
}

export async function getPurchase(depositAddress: string): Promise<Purchase | null> {
  const db = await ready();
  const [row] = rows(await db`select * from advisor_purchases where deposit_address = ${depositAddress}`);
  return row ? toPurchase(row) : null;
}

export async function listPurchases(wallet: string): Promise<Purchase[]> {
  const db = await ready();
  return rows(
    await db`select * from advisor_purchases where wallet = ${wallet} order by created_at desc limit 20`
  ).map(toPurchase);
}

/** Record a 1-Click status; credit the purchase exactly once when it reaches SUCCESS. */
export async function updatePurchaseStatus(depositAddress: string, status: string): Promise<Purchase | null> {
  const db = await ready();
  const [row] = rows(
    await db`update advisor_purchases
             set status = ${status}, updated_at = now(), credited = credited or ${status === "SUCCESS"}
             where deposit_address = ${depositAddress}
             returning *`
  );
  return row ? toPurchase(row) : null;
}

export { monthKey };
