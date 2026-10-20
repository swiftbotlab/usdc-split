import { arcTestnet, type Chain } from 'viem/chains'
import { defineChain } from 'viem'

export const arcMainnet = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
})

export type NetworkKey = 'testnet' | 'mainnet'

export interface NetworkConfig {
  chain: Chain
  address: `0x${string}` | null
  deploymentBlock: bigint | null
}

export const NETWORKS: Record<NetworkKey, NetworkConfig> = {
  testnet: {
    chain: arcTestnet,
    address: '0xcea442379f266e888277e5f29bc721ad3bb3f9a2',
    deploymentBlock: 68114243n,
  },
  mainnet: {
    chain: arcMainnet,
    address: '0x1ddb12d50b11a97106821896d0e70852fa8902e1', // MAINNET_PLACEHOLDER
    deploymentBlock: 26879353n,
  },
}

export const DEFAULT_NETWORK: NetworkKey =
  NETWORKS.mainnet.address ? 'mainnet' : 'testnet'

export function getNetworkKey(raw: string | null | undefined): NetworkKey {
  if (raw === 'testnet' || raw === 'mainnet') return raw
  return DEFAULT_NETWORK
}

export function explorerTx(net: NetworkConfig, hash: string): string {
  const base = net.chain.blockExplorers?.default.url ?? ''
  return `${base}/tx/${hash}`
}

export function explorerAddr(net: NetworkConfig, addr: string): string {
  const base = net.chain.blockExplorers?.default.url ?? ''
  return `${base}/address/${addr}`
}
