/**
 * Decode custom contract errors + common wallet errors to user-friendly strings.
 */

const CONTRACT_ERRORS: Record<string, string> = {
  UnknownSplit: 'Split not found.',
  InvalidRecipients: 'Recipient list must have 2–20 unique, non-zero addresses.',
  ZeroAddress: 'Recipient address cannot be zero.',
  DuplicateRecipient: 'Each recipient can appear only once.',
  InvalidShares: 'Shares must be above 0 and add up to 100%.',
  LabelTooLong: 'Label is too long (max 64 bytes).',
  MemoTooLong: 'Memo is over 128 bytes.',
  InvalidDelay: 'Change delay must be between 60 seconds and 30 days.',
  InvalidController: 'Controller address is invalid.',
  ZeroAmount: 'Enter an amount greater than zero.',
  NothingToWithdraw: 'Nothing to withdraw yet.',
  TransferFailed: 'This address cannot receive USDC.',
  NotController: 'Only the controller can do this.',
  NoPendingChange: 'No pending change to act on.',
  ChangeNotReady: 'The change delay has not passed yet.',
  ChangeExpired: 'This change expired — propose it again.',
  VersionChanged: 'The shares changed since you opened this page. Refresh and confirm.',
}

export function decodeContractError(error: unknown): string {
  if (!error) return 'Unknown error.'

  // Extract message string safely
  let msg = ''
  if (typeof error === 'object' && error !== null && 'message' in error) {
    msg = typeof (error as Record<string, unknown>).message === 'string'
      ? (error as { message: string }).message
      : ''
  }
  if (!msg && typeof error === 'string') msg = error
  const lower = msg.toLowerCase()

  // User rejected
  if (
    lower.includes('user rejected') ||
    lower.includes('user denied') ||
    (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 4001)
  ) {
    return '' // treat as cancellation, not an error
  }

  // Insufficient funds
  if (lower.includes('insufficient funds') || lower.includes('exceeds balance')) {
    return 'Insufficient balance — add USDC to your wallet.'
  }

  // Look for known custom error names in the message
  for (const [name, friendly] of Object.entries(CONTRACT_ERRORS)) {
    if (msg.includes(name)) return friendly
  }

  // Revert with reason string
  const reasonMatch = msg.match(/reason:\s*"?([^"]+)"?/i)
  if (reasonMatch) return `Transaction failed: ${reasonMatch[1]}`

  if (lower.includes('reverted')) return 'Transaction reverted.'
  if (lower.includes('network') || lower.includes('timeout'))
    return 'Network error — check your connection and retry.'

  return 'Something went wrong. Please try again.'
}
