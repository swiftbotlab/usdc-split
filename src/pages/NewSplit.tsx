import { useState, useCallback, useMemo } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { decodeEventLog, parseGwei } from 'viem'
import { Plus, Minus, RefreshCw, AlertCircle } from 'lucide-react'
import { useNetwork } from '../hooks/useNetwork'
import { useChainGuard } from '../hooks/useChainGuard'
import { useTxToast } from '../hooks/useTxToast'
import { USDC_SPLIT_ABI } from '../config/abi'
import { Card, Btn, Input, Badge, ShareBar } from '../components/ui'
import { validateLabel, formatBps } from '../utils/format'
import { decodeContractError } from '../utils/errors'

const SYSTEM_PREFIXES = [
  '0x0000000000000000000000000000000000000000',
  '0x3600000000000000000000000000000000000000',
]

function isSystemAddress(addr: string): boolean {
  const lo = addr.toLowerCase()
  return SYSTEM_PREFIXES.some(p => lo.startsWith(p.slice(0, 6).toLowerCase())) ||
    BigInt(lo || '0x0') < BigInt('0x10000')
}

function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr)
}

interface Row { addr: string; pct: string }

const DELAY_PRESETS = [
  { label: '2 minutes (demo)', seconds: 120 },
  { label: '1 day', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
  { label: 'Custom', seconds: -1 },
]

export function NewSplit() {
  const { netKey, net } = useNetwork()
  const { address: walletAddr } = useAccount()
  const { ensureReady, onCorrectChain, switching } = useChainGuard(net)
  const toast = useTxToast(net)

  const [label, setLabel] = useState('')
  const [rows, setRows] = useState<Row[]>([
    { addr: '', pct: '50.00' },
    { addr: '', pct: '50.00' },
  ])
  const [governance, setGovernance] = useState<'immutable' | 'managed'>('immutable')
  const [controller, setController] = useState('')
  const [delayPreset, setDelayPreset] = useState(1) // 1 day default
  const [customDelay, setCustomDelay] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [txError, setTxError] = useState('')

  const { writeContractAsync } = useWriteContract()
  const [hash, setHash] = useState<`0x${string}` | undefined>()
  const { isLoading: confirming, data: receipt } = useWaitForTransactionReceipt({ hash })

  // ── Derived values ──────────────────────────────────────────────────────────
  const totalBps = useMemo(() => {
    return rows.reduce((sum, r) => {
      const v = parseFloat(r.pct)
      return sum + (isNaN(v) ? 0 : Math.round(v * 100))
    }, 0)
  }, [rows])

  const bpsArray = useMemo(() =>
    rows.map(r => Math.round((parseFloat(r.pct) || 0) * 100)),
  [rows])

  const labelError = validateLabel(label)

  const rowErrors = rows.map((r, i) => {
    if (!r.addr) return ''
    if (!isValidAddress(r.addr)) return 'Invalid address'
    if (r.addr.toLowerCase() === net.address?.toLowerCase()) return 'Cannot be the contract itself'
    if (isSystemAddress(r.addr)) return 'System address — funds would be lost'
    const dup = rows.findIndex((o, j) => j !== i && o.addr.toLowerCase() === r.addr.toLowerCase())
    if (dup >= 0) return 'Duplicate address'
    return ''
  })

  const pctErrors = rows.map(r => {
    const v = parseFloat(r.pct)
    if (isNaN(v) || v <= 0) return 'Must be > 0'
    return ''
  })

  const delaySeconds = useMemo(() => {
    const preset = DELAY_PRESETS[delayPreset]
    if (preset.seconds !== -1) return preset.seconds
    const v = parseInt(customDelay)
    return isNaN(v) ? 0 : v
  }, [delayPreset, customDelay])

  const controllerAddr = useMemo(() => {
    if (governance === 'immutable') return '0x0000000000000000000000000000000000000000'
    const c = controller || walletAddr || ''
    return isValidAddress(c) ? (c as `0x${string}`) : ('0x0000000000000000000000000000000000000000')
  }, [governance, controller, walletAddr])

  const controllerError = useMemo(() => {
    if (governance === 'immutable') return ''
    const c = controller || walletAddr || ''
    if (!isValidAddress(c)) return 'Enter a valid controller address'
    if (c.toLowerCase() === net.address?.toLowerCase()) return 'Controller cannot be the contract itself'
    return ''
  }, [governance, controller, walletAddr, net.address])

  const delayError = useMemo(() => {
    if (governance === 'immutable') return ''
    if (delaySeconds < 60) return 'Minimum 60 seconds'
    if (delaySeconds > 30 * 24 * 3600) return 'Maximum 30 days'
    return ''
  }, [governance, delaySeconds])

  const canSubmit =
    !labelError &&
    rows.length >= 2 &&
    rows.length <= 20 &&
    rows.every((r, i) => isValidAddress(r.addr) && !rowErrors[i] && !pctErrors[i]) &&
    totalBps === 10000 &&
    !controllerError &&
    !delayError &&
    !submitting &&
    !confirming

  // ── Row helpers ─────────────────────────────────────────────────────────────
  const addRow = () => {
    if (rows.length >= 20) return
    setRows(r => [...r, { addr: '', pct: '0.00' }])
  }

  const removeRow = (i: number) => {
    if (rows.length <= 2) return
    setRows(r => r.filter((_, j) => j !== i))
  }

  const updateRow = (i: number, field: keyof Row, value: string) => {
    setRows(r => r.map((row, j) => j === i ? { ...row, [field]: value } : row))
  }

  const splitEvenly = useCallback(() => {
    const n = rows.length
    const base = Math.floor(10000 / n)
    const remainder = 10000 - base * n
    setRows(r => r.map((row, i) => ({
      ...row,
      pct: ((i === 0 ? base + remainder : base) / 100).toFixed(2),
    })))
  }, [rows.length])

  // ── Submit ───────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!canSubmit) return
    setTxError('')
    setSubmitting(true)
    const toastId = toast.pending('Creating split…')
    try {
      await ensureReady()
      const accounts = rows.map(r => r.addr as `0x${string}`)
      const bps = bpsArray.map(b => b)
      const txHash = await writeContractAsync({
        address: net.address!,
        abi: USDC_SPLIT_ABI,
        functionName: 'createSplit',
        args: [label, accounts, bps, controllerAddr, BigInt(governance === 'managed' ? delaySeconds : 0)],
        maxFeePerGas: parseGwei('20'),
        chainId: net.chain.id,
      })
      setHash(txHash)
      toast.confirmed(toastId, txHash, 'Split created')
    } catch (e) {
      const msg = decodeContractError(e)
      if (msg) setTxError(msg)
      toast.failed(toastId, e)
    } finally {
      setSubmitting(false)
    }
  }

  // After confirmation navigate to the split
  if (receipt && !confirming) {
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: USDC_SPLIT_ABI, data: log.data, topics: log.topics })
        if (ev.eventName === 'SplitCreated') {
          const id = (ev.args as { id: bigint }).id
          window.location.hash = `#/${netKey}/split/${id}`
        }
      } catch { /* not our event */ }
    }
  }

  const explorerBase = net.chain.blockExplorers?.default.url ?? ''

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight mb-1">New split</h1>
        <p className="text-slate-500 text-sm">Payments into this address are divided instantly according to these shares.</p>
      </div>

      {!net.address && (
        <Card className="p-6 text-center text-slate-500">Not deployed on this network yet.</Card>
      )}

      {net.address && (
        <>
          {/* Label */}
          <Card className="p-5 space-y-4">
            <h2 className="font-display font-semibold text-slate-800 dark:text-slate-200">Split details</h2>
            <Input
              label="Label (optional)"
              placeholder="e.g. Q4 Revenue Share"
              value={label}
              onChange={e => setLabel(e.target.value)}
              error={labelError ?? undefined}
              hint="Max 64 bytes — shown on the split page and in the timeline."
            />
          </Card>

          {/* Recipients */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-semibold text-slate-800 dark:text-slate-200">
                Recipients
                <span className="text-slate-400 text-sm font-normal ml-2">({rows.length}/20)</span>
              </h2>
              <button
                onClick={splitEvenly}
                className="text-xs text-accent-600 hover:text-accent-700 font-medium flex items-center gap-1"
              >
                <RefreshCw size={12} /> Split evenly
              </button>
            </div>

            {/* Share bar */}
            {totalBps > 0 && <ShareBar bpsArray={bpsArray} />}

            {/* Running total */}
            <div className={`text-right text-sm font-mono tabular font-semibold ${totalBps === 10000 ? 'text-green-600' : 'text-red-500'}`}>
              {(totalBps / 100).toFixed(2)}% / 100.00%
            </div>

            {rows.map((row, i) => (
              <div key={i} className="flex gap-2 items-start">
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="0x… recipient address"
                    value={row.addr}
                    onChange={e => updateRow(i, 'addr', e.target.value.trim())}
                    className={`w-full px-3 py-2.5 rounded-xl border text-sm font-mono bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-accent-500 ${rowErrors[i] ? 'border-red-300' : 'border-slate-200 dark:border-slate-700'}`}
                  />
                  {rowErrors[i] && <span className="text-xs text-red-500 mt-0.5 block">{rowErrors[i]}</span>}
                  {row.addr && !rowErrors[i] && (
                    <span className="text-xs text-slate-400 mt-0.5 block">
                      Make sure this address exists on Arc (smart wallets from other chains may not).
                    </span>
                  )}
                </div>
                <div className="w-24">
                  <div className="relative">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.pct}
                      onChange={e => updateRow(i, 'pct', e.target.value)}
                      className={`w-full px-3 py-2.5 pr-6 rounded-xl border text-sm text-right font-mono tabular bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-accent-500 ${pctErrors[i] ? 'border-red-300' : 'border-slate-200 dark:border-slate-700'}`}
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">%</span>
                  </div>
                  {pctErrors[i] && <span className="text-xs text-red-500 mt-0.5 block">{pctErrors[i]}</span>}
                </div>
                <button
                  onClick={() => removeRow(i)}
                  disabled={rows.length <= 2}
                  className="mt-0.5 p-2.5 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-30 transition-colors"
                  aria-label="Remove recipient"
                >
                  <Minus size={16} />
                </button>
              </div>
            ))}

            <Btn variant="ghost" size="sm" onClick={addRow} disabled={rows.length >= 20}>
              <Plus size={15} /> Add recipient
            </Btn>
          </Card>

          {/* Governance */}
          <Card className="p-5 space-y-4">
            <h2 className="font-display font-semibold text-slate-800 dark:text-slate-200">Governance</h2>
            <div className="grid grid-cols-2 gap-2">
              {(['immutable', 'managed'] as const).map(g => (
                <button
                  key={g}
                  onClick={() => setGovernance(g)}
                  className={`px-4 py-3 rounded-xl border text-sm font-medium transition-all text-left ${
                    governance === g
                      ? 'border-accent-500 bg-accent-50 dark:bg-accent-950 text-accent-700 dark:text-accent-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {g === 'immutable' ? (
                    <>
                      <div className="font-semibold mb-0.5">Immutable</div>
                      <div className="text-xs opacity-70">Recipients and shares are fixed forever.</div>
                    </>
                  ) : (
                    <>
                      <div className="font-semibold mb-0.5">Team-managed</div>
                      <div className="text-xs opacity-70">A controller can propose future changes.</div>
                    </>
                  )}
                </button>
              ))}
            </div>

            {governance === 'managed' && (
              <div className="space-y-3 pt-1">
                <Input
                  label="Controller address"
                  placeholder={walletAddr ?? '0x…'}
                  value={controller}
                  onChange={e => setController(e.target.value.trim())}
                  error={controllerError || undefined}
                  hint={!controller && walletAddr ? `Defaults to your wallet: ${walletAddr.slice(0,10)}…` : undefined}
                />

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Change delay
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {DELAY_PRESETS.map((p, i) => (
                      <button
                        key={p.label}
                        onClick={() => setDelayPreset(i)}
                        className={`px-3 py-2 rounded-xl border text-sm transition-all ${
                          delayPreset === i
                            ? 'border-accent-500 bg-accent-50 dark:bg-accent-950 text-accent-700 dark:text-accent-300'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  {delayPreset === 3 && (
                    <Input
                      className="mt-2"
                      placeholder="Seconds (60 – 2592000)"
                      value={customDelay}
                      onChange={e => setCustomDelay(e.target.value.replace(/\D/g, ''))}
                      error={delayError || undefined}
                    />
                  )}
                  {delayPreset !== 3 && (
                    <p className="text-xs text-slate-400 mt-1">
                      {delayPreset === 0
                        ? 'Short delay for demos — use longer delays in production.'
                        : `Proposed changes execute after ${DELAY_PRESETS[delayPreset].label} and expire after an additional 7 days.`}
                    </p>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* Submit */}
          {txError && (
            <div className="flex items-start gap-2 text-red-600 text-sm bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              {txError}
            </div>
          )}

          {!onCorrectChain && (
            <div className="text-sm text-amber-700 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
              Switch to {net.chain.name} to continue.
            </div>
          )}

          <div className="space-y-3">
            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl px-4 py-3 text-sm text-slate-500 space-y-1">
              <p className="font-medium text-slate-700 dark:text-slate-300">Summary</p>
              <p>{rows.length} recipients · {governance === 'immutable' ? <Badge color="green">Immutable</Badge> : <Badge color="blue">Managed, {formatBps(delaySeconds * 100 / 1)} delay</Badge>}</p>
              <p>Contract: <a href={`${explorerBase}/address/${net.address}`} target="_blank" rel="noopener" className="text-accent-600 hover:underline font-mono text-xs">{net.address?.slice(0,10)}…</a></p>
            </div>

            <Btn
              size="lg"
              className="w-full"
              onClick={handleSubmit}
              loading={submitting || confirming || switching}
              disabled={!canSubmit || !walletAddr}
            >
              {!walletAddr ? 'Connect wallet first' : 'Create split'}
            </Btn>
          </div>
        </>
      )}
    </div>
  )
}
