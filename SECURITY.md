# Security

USDC Split is a single Solidity contract (`contracts/UsdcSplit.sol`) and a static web app. Report problems through a
GitHub issue on this repository (for anything that could put funds at risk, open an issue that only says "security
contact please" and we will reach out).

## What the contract guarantees
- No owner, no admin, no fees, no pause, no upgrades, no `receive()`: USDC only enters through `pay`.
- Every payment is credited in full in the same transaction: recipient 2..n gets `floor(amount * share / 10000)`, the
  first recipient gets the rest (always fewer than 20 wei). `sum(withdrawable + withdrawn) == totalReceived` per split,
  and the contract balance equals `totalHeld`.
- Credited money only ever leaves to the account that earned it (`withdraw` by the account, `distribute` by anyone with
  the funds going to the account). A share change (managed splits only, after the split's fixed delay) applies to future
  payments only; it never moves, reduces or re-routes a credit.
- Every state-changing function is `nonReentrant`; effects happen before the transfer; `distribute` forwards at most
  50,000 gas per recipient without copying return data and skips a recipient that cannot receive (its credit stays).

## Known limitations
- A controller (if one was set at creation) can redirect FUTURE payments after the delay; everyone can see a pending
  change (event + app banner) during the delay. Immutable splits (no controller) can never change.
- A recipient that cannot receive native USDC (for example a blocklisted address) keeps its credit until it can.
- Labels and memos are public, untrusted text; the app renders them as plain text only.
- The app is served by GitHub Pages, which cannot send `X-Frame-Options` / `frame-ancestors` headers; the app refuses to
  run inside frames other than Arc Studio's preview. Your wallet still shows every transaction before you sign.

## Testing
Foundry unit, fuzz and stateful invariant tests (`contracts/test/`). The deployed mainnet bytecode is byte-identical to the
Arc Testnet deployment made by Arc Studio (checked by our deploy script before sending), and the source is verified on
explorer.arc.io.
