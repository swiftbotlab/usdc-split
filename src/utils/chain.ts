/**
 * Chain / network safety helpers.
 */
import type { PublicClient } from 'viem'

/** Returns true when the contract bytecode is non-empty at the given address. */
export async function contractExists(
  client: PublicClient,
  address: `0x${string}`
): Promise<boolean> {
  try {
    const code = await client.getBytecode({ address })
    return !!code && code !== '0x'
  } catch {
    return false
  }
}
