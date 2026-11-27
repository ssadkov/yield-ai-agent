/**
 * The NEAR Hackathon demo is Solana only (decided 2026-11-10/11). Aptos stays wired underneath —
 * Phantom still connects through the Aptos adapter's derived wallet — but nothing Aptos is shown:
 * no Aptos address, Aptos Safes, Aptos wallet button, Aptos deposit route or Aptos host warning.
 * Flip to true to bring it back.
 */
export const SHOW_APTOS = false;

/**
 * Yield AI agents on Aptos (decided 2026-11-25, Boost season 3 gets the private model): connect a
 * native Aptos wallet such as Petra, see one's Aptos agents and Boost on the left, and let the
 * advisor read them. Aptos deposits, Aptos Safe creation and the host warning stay behind SHOW_APTOS.
 */
export const SHOW_APTOS_AGENT = true;
/** The Aptos connect buttons and the Aptos address row in the wallet menu. */
export const SHOW_APTOS_CONNECT = SHOW_APTOS || SHOW_APTOS_AGENT;
