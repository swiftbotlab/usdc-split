/**
 * Resolve the active network from the URL hash.
 * Route format: #/<net>/...
 * Falls back to localStorage then DEFAULT_NETWORK.
 */
import { useMemo } from 'react'
import { DEFAULT_NETWORK, NETWORKS, getNetworkKey, type NetworkKey, type NetworkConfig } from '../config/networks'

const LS_KEY = 'usdc-split:network'

export function useNetwork(): { netKey: NetworkKey; net: NetworkConfig } {
  const netKey = useMemo<NetworkKey>(() => {
    // 1. Parse from hash: #/testnet/... or #/mainnet/...
    const hash = typeof window !== 'undefined' ? window.location.hash : ''
    const match = hash.match(/^#\/(testnet|mainnet)(?:\/|$)/)
    if (match) {
      const key = getNetworkKey(match[1])
      // Persist to localStorage for next load
      try { localStorage.setItem(LS_KEY, key) } catch { /* noop */ }
      return key
    }
    // 2. localStorage fallback
    try {
      const stored = localStorage.getItem(LS_KEY)
      if (stored === 'testnet' || stored === 'mainnet') return stored
    } catch { /* noop */ }
    // 3. Default
    return DEFAULT_NETWORK
  }, [
    // Re-compute when hash changes. We use a stable reference trick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    typeof window !== 'undefined' ? window.location.hash : '',
  ])

  return { netKey, net: NETWORKS[netKey] }
}
