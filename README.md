# USDC Split

Split incoming USDC between your team on Arc: every payment is divided the moment it lands.

**Live app:** https://swiftbotlab.github.io/usdc-split/ (Arc mainnet by default; Arc Testnet in the header toggle)
**Built with Arc Studio:** https://studio.arc.io/app/252c6ded-95ab-41e8-b3da-6a411667d1d8 · by Swift Bot Labs

## What it does
- Anyone creates a **split**: 2 to 20 recipients with shares in basis points that add up to 100%, plus a label.
- Anyone pays native USDC into it with a memo (an invoice number, for example). The payment is **credited to every
  recipient in the same transaction**. No token approval: on Arc, USDC is the native coin.
- Recipients **withdraw** their credit any time; anyone can **release** one recipient's credit to that recipient, or
  **distribute** to all current recipients at once. A recipient that cannot receive USDC is skipped and keeps its credit.
- Splits are **immutable by default**. A split created with a controller and a fixed delay (60 s to 30 days) can change
  its table for FUTURE payments only: the controller proposes, anyone applies it once the delay has passed, it expires
  7 days after it became ready, and the controller can lock the split for good. Money already credited never moves.
- Pay links pin the version of the shares the payer saw (`payAtVersion`): if the table changed, the payment reverts.

**Credit rule (exact, public):** for a payment of `amount`, recipient `i >= 1` gets `floor(amount * bps_i / 10000)`
and the first recipient gets the rest, so every wei is assigned. Example: 0.30 USDC into 50/30/20 credits
0.15 / 0.09 / 0.06. 0.15 USDC into 33.34/33.33/33.33 credits 0.05001 / 0.049995 / 0.049995.
Invariant per split: paid in = withdrawable + withdrawn, to the wei; the contract balance equals the total held.
No owner, no admin, no fees, no pause, no upgrades.

## Deployments
| Network | Contract | Notes |
|---|---|---|
| Arc Mainnet (5042) | [0x1ddb12d50b11a97106821896d0e70852fa8902e1](https://explorer.arc.io/address/0x1ddb12d50b11a97106821896d0e70852fa8902e1) | block 26879353; deployed by us with bytecode byte-identical to Studio's testnet deployment |
| Arc Testnet (5042002) | [0xcea442379f266e888277e5f29bc721ad3bb3f9a2](https://explorer.testnet.arc.io/address/0xcea442379f266e888277e5f29bc721ad3bb3f9a2) | block 68114243; deployed by Arc Studio; source verified (full match) |

## Real USDC on Arc mainnet (two demo splits, all roles are fresh addresses)
| What | USDC | Transaction |
|---|---|---|
| deploy UsdcSplit | - | [0x36729210…7adb](https://explorer.arc.io/tx/0x36729210f85dd1628af64e0c29ba445e568341b6a529063c2996fa048d1e7adb) |
| creator creates split 'Even three-way (demo)' | - | [0x54cf1cd4…b11f](https://explorer.arc.io/tx/0x54cf1cd4db2f1ab4744661568e0374ff917e3afc7d3d742495b50ad7240bb11f) |
| payer pays 0.150000 USDC into A (#1) memo 'INV-0001' | 0.150000 | [0xde0477fe…bafc](https://explorer.arc.io/tx/0xde0477feb9528b85ce253a1f674d4f60a922f96c3076c9a421bca1c9aafcbafc) |
| r1 withdraws its credit from A (#1) (pull) | - | [0x1c13bb39…37f7](https://explorer.arc.io/tx/0x1c13bb394d942ac208ea3e83a91cd0c43b92e2693af3e144009eb3061cdb37f7) |
| payer distributes A (#1) (pushes r2, r3) | - | [0x0e25240c…8cf3](https://explorer.arc.io/tx/0x0e25240c6bb6c7d00a08f1febe8ba2becd53bdf1c71717e4c9a5afd474408cf3) |
| creator creates split 'Team treasury (demo)' | - | [0xba622ede…57b0](https://explorer.arc.io/tx/0xba622ede532c1f3000a9b5589ab80b36ee01df92a74fb96581ecf645dc3457b0) |
| payer pays 0.060000 USDC into B (#2) memo 'INV-0002' | 0.060000 | [0x6ca753c9…f4a7](https://explorer.arc.io/tx/0x6ca753c9eadab6ad89ccf9d943b394a9568200737128637f0f9fc58dae89f4a7) |
| creator (controller) proposes 2000/4000/4000 for B (#2) | - | [0x49a74bc2…d08f](https://explorer.arc.io/tx/0x49a74bc219471050583c34a7014ffd0f2c0e0696d2370bd8d6f3f9e5f367d08f) |
| payer executes the change of B (#2) (anyone may) | - | [0xfc80a449…dcd9](https://explorer.arc.io/tx/0xfc80a449afdc86bdb52b6ae0545c535ce9a5667368db2b8a40e7f916afb2dcd9) |
| payer pays 0.040000 USDC into B (#2) memo 'INV-0003' pinned to version 2 (payAtVersion) | 0.040000 | [0x5ac96478…27ff](https://explorer.arc.io/tx/0x5ac964785e22f54c4f7facf4660a7f29eb1b65b724ca90b8d38d39cb0b9b27ff) |
| payer distributes B (#2) (pushes r1, r2, r3) | - | [0xaeaca401…6292](https://explorer.arc.io/tx/0xaeaca4011e4988adc360e68a992dfbc9b32a7cadcaaf91214e5a64b3e3a46292) |

Results, checked to the wei by our runner: split A credited 0.05001 / 0.049995 / 0.049995 (one recipient pulled, a third
party pushed the rest); split B credited 0.03 / 0.018 / 0.012 at 50/30/20, changed to 20/40/40 after its 120 s delay
(an early apply reverted `ChangeNotReady`), then 0.04 credited 0.008 / 0.016 / 0.016 and distributed. Both splits end
with nothing held.

## How Arc Studio was used
- **Contract pipeline** (CLI turns p1, p1b, p1c in session `split`): Studio wrote `contracts/UsdcSplit.sol` from our spec,
  ran its solidity and functional auditors and Slither (no contract changes needed), wrote the Foundry suite in
  `contracts/test/` (unit, managed-change lifecycle, reentrancy proof for every entry point, fuzz, and a stateful
  invariant suite: 256 runs x 500 calls), reported 101/101 passing, and deployed to Arc Testnet.
- **App build** (turn p3): Studio wrote the React + wagmi/viem app in `src/` against both deployments. The turn hit the
  daily Studio budget while fixing lint findings, before its own `bun run build`; GitHub Actions builds this exact source
  with Studio's `bun.lock` (`.github/workflows/pages.yml`).
- **Our checks around Studio:** we re-ran Studio's suite offline (95 forge tests incl. the invariant run, all green) and
  our own reference suite (57 tests + 4 invariants) against Studio's source: 59/60 pass; the one difference is the ORDER of
  `Credited` events (Studio emits recipient #1, the one with the rounding remainder, last; amounts are identical).
  Demo flows ran on Arc Testnet and mainnet with 123 checks each. The mainnet deploy script refuses unless the bytecode is
  identical to Studio's testnet deployment.
- **Hand edits (disclosed):** this README, `.gitignore`, `SECURITY.md`, `LICENSE`, `logo.png` and the Pages workflow.
  The contract, tests and app source are as Studio wrote them.

## Run locally
```
bun install --frozen-lockfile
bun run dev            # app
forge test             # contracts (Foundry, solc 0.8.28)
```

## Limitations
Up to 20 recipients per split; `distribute` covers current recipients only (anyone can `release` a former one); a
recipient that cannot receive USDC keeps its credit until it can; on-chain data (labels, memos, amounts) is public; anyone
can create a split that names any address (the app hides zero-balance splits you did not create); a controller can
redirect FUTURE payments after the public delay; credits are per payment (no streaming).

## License
MIT
