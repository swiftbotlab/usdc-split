# [App Name]

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** - what Arc Studio remembers about building this app. It helps future agents (or humans) understand and extend the project.

---

## What This App Does

UsdcSplit: revenue splitting and shared treasuries in native USDC on Arc.

## Deployed Contracts

### UsdcSplit
- **Network:** Arc Testnet
- **Address:** `0xcea442379f266e888277e5f29bc721ad3bb3f9a2`
- **Tx Hash:** `0x5f131af656f541ef9165fca01d3d90113d1296568ef0324266ea9366104ecbc7`
- **Block:** 68114243
- **Explorer:** https://explorer.testnet.arc.io/address/0xcea442379f266e888277e5f29bc721ad3bb3f9a2
- **ABI:** `contracts/contract-metadata/UsdcSplit.json`
- **Source:** `contracts/UsdcSplit.sol`

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry. Sources in `contracts/`, unit tests in `contracts/test/*.t.sol`. Build with `bun run contracts:build` (`forge build`), test with `bun run contracts:test` (`forge test`).
- Wallet: injected (MetaMask, etc.)
- Chain: Arc Testnet (Chain ID: 5042002, imported from `viem/chains`)
- Token: USDC (6 decimals) (Address: 0x3600000000000000000000000000000000000000, Chain: Arc Testnet)
- Toasts: Sonner

## Key Files

- `src/App.tsx` - Main application logic
- `src/components/` - UI components
- `src/config.ts` - wagmi config (chains, connectors, transports)

## To Run

```bash
bun install
bun run dev
```
