"use client";

/**
 * Aptos Gas Station (mainnet) for owner transactions signed on this page: pause, resume and
 * withdraw from a Yield AI Safe. Same key and service as yieldai.app
 * (`NEXT_PUBLIC_APTOS_GAS_STATION_KEY`); without it, a native Aptos wallet pays its own gas and a
 * Solana-derived account (no APT) cannot send.
 */
import { GasStationClient, GasStationTransactionSubmitter } from "@aptos-labs/gas-station-client";
import { Network, type TransactionSubmitter } from "@aptos-labs/ts-sdk";

let submitter: TransactionSubmitter | null | undefined;

export function gasStationSubmitter(): TransactionSubmitter | null {
  if (submitter !== undefined) return submitter;
  const apiKey = process.env.NEXT_PUBLIC_APTOS_GAS_STATION_KEY?.trim();
  submitter =
    typeof window !== "undefined" && apiKey
      ? new GasStationTransactionSubmitter(new GasStationClient({ network: Network.MAINNET, apiKey }))
      : null;
  return submitter;
}
