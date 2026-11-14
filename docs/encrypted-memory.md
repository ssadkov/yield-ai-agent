# Encrypted, wallet-keyed memory (design, not built)

Today the chat history sits in plain `localStorage` on the user's device (README, Limitations). This is the design
that replaces it. Item 4 of "What's next".

## What is stored

A short summary, a few kilobytes, not the transcript: the user's goals, risk profile and past decisions. The
browser updates it at the end of a session and sends it to the model, encrypted like every other message, at the
start of the next one.

## The key

1. The wallet signs a fixed, human-readable message, for example `Yield AI advisor memory key v1`.
2. HKDF-SHA256 over that signature gives a 32-byte key.
3. The summary is encrypted with XChaCha20-Poly1305 under that key.

The key is never stored. Any device with the same wallet can derive it again.

**Check first:** the signature must be deterministic for every supported wallet (sign twice, compare). Ed25519
signatures are deterministic by specification, but a wallet that adds randomness or a timestamp to the message
would make the key unrecoverable, and would need a different scheme.

## Where the ciphertext lives

First on our server or in `localStorage`; either way only ciphertext leaves the browser. Writing it on chain is an
option, but a ciphertext on chain is permanent, so only the summary would go there, never the transcript.

## Done when

A second session from the same wallet, on another device, "remembers" a goal stated in the first, and the server
holds only ciphertext.
