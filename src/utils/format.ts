/**
 * Formatting helpers for native-USDC values (18 decimals on Arc).
 * Uses formatUnits from viem; never uses the 6-decimal ERC-20 view.
 */
import { formatUnits } from 'viem'

/** Format a raw 18-decimal native-USDC bigint to a human-readable string. */
export function formatUsdc(raw: bigint, maxDecimals = 6): string {
  if (raw === 0n) return '0'
  const full = formatUnits(raw, 18)
  const num = parseFloat(full)
  if (num === 0) return '0'
  if (num < 0.0001) return num.toFixed(10).replace(/0+$/, '').replace(/\.$/, '')
  if (num < 0.01) return num.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
  if (num < 1) return num.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  return num.toFixed(Math.min(maxDecimals, 6)).replace(/0+$/, '').replace(/\.$/, '')
}

/** Parse a user-entered string (e.g. "0.30") to 18-decimal bigint. Returns null on invalid input. */
export function parseUsdc(value: string): bigint | null {
  if (!value || !/^\d{1,12}(\.\d{1,18})?$/.test(value)) return null
  try {
    const [whole, frac = ''] = value.split('.')
    const padded = frac.padEnd(18, '0').slice(0, 18)
    return BigInt(whole) * 10n ** 18n + BigInt(padded)
  } catch {
    return null
  }
}

/** Format a bigint bps (0-10000) as "XX.XX%" */
export function formatBps(bps: number): string {
  return (bps / 100).toFixed(2) + '%'
}

/** Shorten an address to 0x1234…5678 */
export function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/** Format a unix timestamp (seconds) as a locale string. */
export function formatTs(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/** Format a countdown in seconds to "Xd Xh Xm Xs" */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'now'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const parts: string[] = []
  if (d) parts.push(`${d}d`)
  if (h) parts.push(`${h}h`)
  if (m) parts.push(`${m}m`)
  if (!d && s) parts.push(`${s}s`)
  return parts.join(' ')
}

/** Validate a memo: at most 128 UTF-8 bytes. Returns error string or null. */
export function validateMemo(memo: string): string | null {
  const bytes = new TextEncoder().encode(memo).length
  if (bytes > 128) return `Memo is ${bytes} bytes — max is 128`
  return null
}

/** Validate a label: at most 64 bytes. Returns error string or null. */
export function validateLabel(label: string): string | null {
  const bytes = new TextEncoder().encode(label).length
  if (bytes > 64) return `Label is ${bytes} bytes — max is 64`
  return null
}
