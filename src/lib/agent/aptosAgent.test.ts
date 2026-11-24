import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as aptosAgentModule from "./aptosAgent.ts";
const { fetchAptosAgent, formatAptosAgentForTool, isAptosAddress, parseBoostAccount } = aptosAgentModule;

const fixture = JSON.parse(readFileSync(new URL("./fixtures/boost-account.json", import.meta.url), "utf8")) as { data: Record<string, unknown> };

test("the Boost account answer becomes the owner's agents, largest first, with strategy labels", () => {
  const state = parseBoostAccount(fixture);
  assert.ok(state);
  if (!state) return;
  assert.equal(state.safes.length, 4);
  assert.deepEqual(state.safes.map((s) => s.label), ["Echelon stable loop", "Hyperion CLMM LP", "Stablecoin compound", "Hyperion CLMM LP"]);
  assert.ok(Math.abs(state.totalUsd - 1510.9) < 0.01);
  assert.equal(state.boost.eligible, true);
  assert.equal(state.boost.rateAprPct, 3);
});

test("the tool text carries the API's numbers and says this desk cannot sign Aptos transactions", () => {
  const text = formatAptosAgentForTool(parseBoostAccount(fixture));
  assert.match(text, /4 Yield AI agent Safe\(s\), \$1,511 in total/);
  assert.match(text, /Echelon stable loop .*\$1,246/);
  assert.match(text, /\+3% APR/);
  assert.match(text, /cannot sign Aptos transactions/);
});

test("an owner below the minimum is told the shortfall, and no agents is said plainly", () => {
  const below = { data: { ...fixture.data, eligible: false, reason: "below_threshold", shortfallUsd: 40, byAgent: [{ safe: `0x${"9".repeat(64)}`, strategy: "stablecoin_compound", balanceUsd: 59 }] } };
  assert.match(formatAptosAgentForTool(parseBoostAccount(below)), /\$40 more needed to reach the \$99 minimum/);
  assert.match(formatAptosAgentForTool(parseBoostAccount({ data: { ...fixture.data, byAgent: [] } })), /No Yield AI agent with a balance on Aptos/);
});

test("malformed answers and addresses are refused before any request", async () => {
  assert.equal(parseBoostAccount({ error: "x" }), null);
  assert.equal(isAptosAddress("0x" + "a".repeat(64)), true);
  assert.equal(isAptosAddress("../../admin"), false);
  let called = false;
  const state = await fetchAptosAgent("not-an-address", "", (async () => {
    called = true;
    return new Response("{}");
  }) as typeof fetch);
  assert.equal(state, null);
  assert.equal(called, false);
});

test("live strategy yields from the main app become one line per variant, with risk and Boost", () => {
  const { formatStrategyYieldsForTool } = aptosAgentModule;
  const text = formatStrategyYieldsForTool({
    success: true,
    data: {
      updatedAt: "2026-11-25T10:00:00Z",
      boost: { enabled: true, rateAprPct: 3, minBalanceUsd: 99 },
      strategies: [
        { id: "echelon_looping", label: "Echelon stable loop", risk: "Leverage and liquidation risk.", variants: [{ key: "usd1", label: "USD1 loop", baseAprPct: 9.5, boostAprPct: 12.3, totalAprPct: 21.8, leverage: 4.1 }] },
        { id: "hyperion_lp", label: "Hyperion CLMM LP", risk: "Divergence loss.", variants: [{ key: "apt", label: "APT/USDC", baseAprPct: null, boostAprPct: 3, totalAprPct: null }] },
      ],
    },
  });
  assert.ok(text);
  assert.match(text ?? "", /\+3% APR on eligible deposits \(owner total from \$99\)/);
  assert.match(text ?? "", /USD1 loop, 4.1x: base 9.50% \+ Boost 12.30% = 21.80%/);
  assert.match(text ?? "", /APT\/USDC: base n\/a \+ Boost 3.00% = n\/a/);
  assert.equal(formatStrategyYieldsForTool({ error: "nope" }), null);
});
