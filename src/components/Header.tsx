import { ConnectKitButton } from 'connectkit'
import { Link } from 'lucide-react'
import { useNetwork } from '../hooks/useNetwork'
import { type NetworkKey } from '../config/networks'

export function Header() {
  const { netKey } = useNetwork()

  function toggleNetwork() {
    const next: NetworkKey = netKey === 'mainnet' ? 'testnet' : 'mainnet'
    window.location.hash = `#/${next}/`
  }

  return (
    <header className="sticky top-0 z-40 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-800/60">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-3">
        {/* Logo + wordmark */}
        <a
          href={`#/${netKey}/`}
          className="flex items-center gap-2 font-display font-semibold text-slate-900 dark:text-slate-100 text-[15px] hover:text-accent-600 transition-colors"
        >
          <span className="w-7 h-7 rounded-lg bg-accent-600 flex items-center justify-center">
            <Link size={14} className="text-white" strokeWidth={2.5} />
          </span>
          <span className="tracking-tight">USDC Split</span>
        </a>

        <div className="flex-1" />

        {/* Network toggle */}
        <button
          onClick={toggleNetwork}
          className={`text-xs font-mono px-2.5 py-1 rounded-full border transition-colors ${
            netKey === 'mainnet'
              ? 'border-accent-300 bg-accent-50 text-accent-700 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-300'
              : 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300'
          }`}
          title={`Switch to ${netKey === 'mainnet' ? 'testnet' : 'mainnet'}`}
        >
          {netKey === 'mainnet' ? 'Arc Mainnet' : 'Arc Testnet'}
        </button>

        {/* Nav links */}
        <nav className="hidden sm:flex items-center gap-1">
          <a
            href={`#/${netKey}/new`}
            className="text-sm px-3 py-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors font-medium"
          >
            New split
          </a>
          <a
            href={`#/${netKey}/me`}
            className="text-sm px-3 py-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors font-medium"
          >
            My splits
          </a>
        </nav>

        <ConnectKitButton />
      </div>
    </header>
  )
}
