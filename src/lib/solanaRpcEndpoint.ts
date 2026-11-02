/**
 * Public Solana RPC for the wallet adapter's ConnectionProvider.
 *
 * Yield AI proxies HTTP RPC through `/api/solana/rpc` so a server-side key never
 * reaches the browser. This repo has no RPC key, so it uses the public endpoint.
 * Connecting a wallet only needs it for light reads.
 */
export const PUBLIC_SOLANA_HTTP_ENDPOINT = "https://api.mainnet-beta.solana.com";
export const PUBLIC_SOLANA_WS_ENDPOINT = "wss://api.mainnet-beta.solana.com";

export function getPublicSolanaRpcEndpoint(): string {
  return PUBLIC_SOLANA_HTTP_ENDPOINT;
}
