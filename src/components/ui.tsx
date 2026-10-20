/**
 * Shared micro-components.
 */
import { type ReactNode, type ButtonHTMLAttributes } from 'react'
import { Loader2 } from 'lucide-react'
import { clsx } from 'clsx'

// ─── Card ────────────────────────────────────────────────────────────────────
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx(
      'bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm',
      className
    )}>
      {children}
    </div>
  )
}

// ─── Button ───────────────────────────────────────────────────────────────────
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant
  loading?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export function Btn({
  variant = 'primary',
  loading = false,
  size = 'md',
  children,
  disabled,
  className = '',
  ...rest
}: BtnProps) {
  const base =
    'inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]'

  const variants: Record<BtnVariant, string> = {
    primary:
      'bg-accent-600 hover:bg-accent-700 text-white shadow-sm',
    secondary:
      'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200',
    ghost:
      'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300',
    danger:
      'bg-red-500 hover:bg-red-600 text-white',
  }

  const sizes: Record<'sm' | 'md' | 'lg', string> = {
    sm: 'text-xs px-3 py-1.5 min-h-[32px]',
    md: 'text-sm px-4 py-2.5 min-h-[44px]',
    lg: 'text-base px-6 py-3 min-h-[52px]',
  }

  return (
    <button
      disabled={disabled || loading}
      className={clsx(base, variants[variant], sizes[size], className)}
      {...rest}
    >
      {loading && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  )
}

// ─── Input ────────────────────────────────────────────────────────────────────
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

export function Input({ label, error, hint, className = '', ...rest }: InputProps) {
  return (
    <label className="block">
      {label && (
        <span className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
          {label}
        </span>
      )}
      <input
        className={clsx(
          'w-full px-3.5 py-2.5 rounded-xl border text-sm font-sans',
          'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100',
          'placeholder:text-slate-400 dark:placeholder:text-slate-500',
          'focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent',
          'disabled:opacity-50',
          error
            ? 'border-red-300 dark:border-red-700'
            : 'border-slate-200 dark:border-slate-700',
          className
        )}
        {...rest}
      />
      {hint && !error && (
        <span className="block text-xs text-slate-400 dark:text-slate-500 mt-1">{hint}</span>
      )}
      {error && <span className="block text-xs text-red-500 mt-1">{error}</span>}
    </label>
  )
}

// ─── Badge ───────────────────────────────────────────────────────────────────
type BadgeColor = 'green' | 'amber' | 'blue' | 'slate' | 'red'
export function Badge({ children, color = 'slate' }: { children: ReactNode; color?: BadgeColor }) {
  const colors: Record<BadgeColor, string> = {
    green: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800',
    amber: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
    blue:  'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800',
    slate: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    red:   'bg-red-50 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300 dark:border-red-800',
  }
  return (
    <span className={clsx('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border', colors[color])}>
      {children}
    </span>
  )
}

// ─── Spinner ──────────────────────────────────────────────────────────────────
export function Spinner({ size = 20 }: { size?: number }) {
  return <Loader2 size={size} className="animate-spin text-accent-500" />
}

// ─── Addr ────────────────────────────────────────────────────────────────────
export function Addr({
  addr,
  explorerBase,
  shorten = true,
}: {
  addr: string
  explorerBase?: string
  shorten?: boolean
}) {
  const display = shorten ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr
  if (!explorerBase) {
    return <span className="font-mono text-xs">{display}</span>
  }
  return (
    <a
      href={`${explorerBase}/address/${addr}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs text-accent-600 hover:underline"
    >
      {display}
    </a>
  )
}

// ─── ShareBar ────────────────────────────────────────────────────────────────
const PALETTE = [
  'bg-teal-500', 'bg-emerald-500', 'bg-cyan-500', 'bg-green-500',
  'bg-indigo-400', 'bg-violet-400', 'bg-sky-500', 'bg-lime-500',
  'bg-teal-400', 'bg-emerald-400', 'bg-cyan-400', 'bg-green-400',
  'bg-indigo-500', 'bg-violet-500', 'bg-sky-400', 'bg-lime-400',
  'bg-teal-600', 'bg-emerald-600', 'bg-cyan-600', 'bg-green-600',
]
export function ShareBar({ bpsArray }: { bpsArray: number[] }) {
  return (
    <div className="h-2 flex rounded-full overflow-hidden gap-px">
      {bpsArray.map((bps, i) => (
        <div
          key={i}
          className={clsx('h-full', PALETTE[i % PALETTE.length])}
          style={{ width: `${bps / 100}%` }}
          title={`${(bps / 100).toFixed(2)}%`}
        />
      ))}
    </div>
  )
}
