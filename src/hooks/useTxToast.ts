/**
 * Toast helpers for transaction lifecycle.
 */
import { toast } from 'sonner'
import { decodeContractError } from '../utils/errors'
import type { NetworkConfig } from '../config/networks'
import { explorerTx } from '../config/networks'

export function useTxToast(net: NetworkConfig) {
  function pending(msg = 'Transaction pending…') {
    return toast.loading(msg)
  }

  function confirmed(toastId: string | number, hash: string, msg = 'Confirmed') {
    toast.success(msg, {
      id: toastId,
      action: {
        label: 'View',
        onClick: () => window.open(explorerTx(net, hash), '_blank', 'noopener'),
      },
      duration: 8000,
    })
  }

  function failed(toastId: string | number, error: unknown) {
    const msg = decodeContractError(error)
    if (!msg) {
      toast.dismiss(toastId) // user cancelled — silent
      return
    }
    toast.error(msg, { id: toastId, duration: 10000 })
  }

  return { pending, confirmed, failed }
}
