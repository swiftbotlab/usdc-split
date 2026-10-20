/**
 * Ensures the wallet is on the correct chain before writes.
 * Returns { onCorrectChain, switchToCorrect, checking }.
 */
import { useAccount, useSwitchChain, usePublicClient } from 'wagmi'
import { useState, useCallback } from 'react'
import type { NetworkConfig } from '../config/networks'
import { contractExists } from '../utils/chain'

export function useChainGuard(net: NetworkConfig) {
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const client = usePublicClient({ chainId: net.chain.id })
  const [switching, setSwitching] = useState(false)
  const [bytecodeChecked, setBytecodeChecked] = useState(false)

  const onCorrectChain = chainId === net.chain.id

  /** Call before the first write on a network. Throws on failure. */
  const ensureReady = useCallback(async (): Promise<void> => {
    if (!onCorrectChain) {
      setSwitching(true)
      try {
        await switchChainAsync({ chainId: net.chain.id })
      } finally {
        setSwitching(false)
      }
    }
    if (!bytecodeChecked && net.address && client) {
      const exists = await contractExists(client, net.address)
      if (!exists) throw new Error(`Contract not found on ${net.chain.name}`)
      setBytecodeChecked(true)
    }
  }, [onCorrectChain, switchChainAsync, net, bytecodeChecked, client])

  return { onCorrectChain, ensureReady, switching }
}
