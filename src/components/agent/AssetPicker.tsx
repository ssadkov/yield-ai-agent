"use client";

/* eslint-disable @next/next/no-img-element -- small local logos under the /agent basePath */
import { INTENTS_NETWORKS, networkOf } from "@/lib/agent/intentsAssets";

/** Pick a network, then a token on it (stablecoins first). Logos are local files in public/tokens. */
export function AssetPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (assetId: string) => void;
  disabled?: boolean;
}) {
  const current = networkOf(value) ?? INTENTS_NETWORKS[0];
  const chip = (selected: boolean) =>
    [
      "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[13px] transition-colors disabled:opacity-50",
      selected ? "border-foreground/40 bg-background font-medium shadow-sm" : "border-border/70 text-muted-foreground hover:bg-muted",
    ].join(" ");
  return (
    <div className="space-y-2">
      <div>
        <p className="mb-1 text-[12px] text-muted-foreground">Network</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Network">
          {INTENTS_NETWORKS.map((network) => (
            <button
              key={network.id}
              type="button"
              role="radio"
              aria-checked={network.id === current.id}
              disabled={disabled}
              onClick={() => onChange(network.assets[0].id)}
              className={chip(network.id === current.id)}
            >
              <img src={network.logo} alt="" width={16} height={16} className="h-4 w-4 rounded-full" />
              {network.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 text-[12px] text-muted-foreground">Token on {current.label}</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Token">
          {current.assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              role="radio"
              aria-checked={asset.id === value}
              disabled={disabled}
              onClick={() => onChange(asset.id)}
              className={chip(asset.id === value)}
            >
              <img src={asset.logo} alt="" width={16} height={16} className="h-4 w-4 rounded-full" />
              {asset.symbol}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
