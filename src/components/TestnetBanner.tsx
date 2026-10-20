import { AlertTriangle } from 'lucide-react'

export function TestnetBanner() {
  return (
    <div className="bg-amber-50 dark:bg-amber-950/50 border-b border-amber-200 dark:border-amber-800">
      <div className="max-w-5xl mx-auto px-4 py-2 flex items-center gap-2 text-amber-700 dark:text-amber-300 text-sm">
        <AlertTriangle size={14} strokeWidth={2} />
        <span>Arc Testnet — test USDC only, no real value</span>
      </div>
    </div>
  )
}
