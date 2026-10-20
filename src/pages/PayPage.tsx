import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi'
import { decodeEventLog, keccak256, toBytes, parseGwei, parseUnits } from 'viem'
import { AlertTriangle, Check, AlertCircle } from 'lucide-react'
import { useNetwork } from '../hooks/useNetwork'
import { useChainGuard } from '../hooks/useChainGuard'
import { useTxToast } from '../hooks/useTxToast'
import { USDC_SPLIT_ABI } from '../config/abi'
import { Card, Btn, Input, Spinner, Badge } from '../components/ui'
import { formatUsdc, parseUsdc, validateMemo, shortAddr } from '../utils/format'
import { decodeContractError } from '../utils/errors'
import { fetchLogsChunked } from '../utils/logs'
import { sanitiseText } from '../utils/bidi'
import { explorerTx } from '../config/networks'

interface CreditedLine { account: `0x${string}`; amount: bigint }

// Reference checking is implemented inline in the main component below.

// ─── Main page ────────────────────────────────────────────────────────────────
export function PayPage({
  id,
  initAmount,
  initMemo,
  initVersion,
}: {
  id: string
  initAmount?: string
  initMemo?: string
  initVersion?: string
}) {
  const { netKey, net } = useNetwork()
  const { address: walletAddr } = useAccount()
  const { ensureReady, onCorrectChain, switching } = useChainGuard(net)
  const toast = useTxToast(net)
  const client = usePublicClient({ chainId: net.chain.id })

  const splitId = /^[1-9]\d*$/.test(id) ? BigInt(id) : null
  const contractAddr = net.address
  const chainId = net.chain.id
  const explorerBase = net.chain.blockExplorers?.default.url ?? ''

  // ── URL param validation ────────────────────────────────────────────────────
  const parsedInitAmount = useMemo(() => {
    if (!initAmount) return ''
    if (/^\d{1,12}(\.\d{1,18})?$/.test(initAmount)) {
      const n = parseFloat(initAmount)
      if (n > 0) return initAmount
    }
    return ''
  }, [initAmount])

  const parsedInitMemo = useMemo(() => {
    if (!initMemo) return ''
    const bytes = new TextEncoder().encode(initMemo).length
    if (bytes > 128) return ''
    return initMemo
  }, [initMemo])

  const [amount, setAmount] = useState(parsedInitAmount)
  const [memo, setMemo] = useState(parsedInitMemo)
  const [submitting, setSubmitting] = useState(false)
  const [txError, setTxError] = useState('')
  const [hash, setHash] = useState<`0x${string}` | undefined>()
  const [creditedLines, setCreditedLines] = useState<CreditedLine[]>([])

  // Warn when URL params were ignored
  const amountIgnored = initAmount && !parsedInitAmount
  const memoIgnored = initMemo && !parsedInitMemo

  // ── Reads ───────────────────────────────────────────────────────────────────
  const { data: splitCount } = useReadContract({
    address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'splitCount',
    chainId, query: { enabled: !!contractAddr },
  })

  const idValid = splitId !== null && splitCount !== undefined && splitId <= (splitCount) && splitId > 0n

  const { data: rawSplit } = useReadContract({
    address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'getSplit',
    args: splitId ? [splitId] : undefined, chainId,
    query: { enabled: !!contractAddr && idValid, refetchInterval: 10_000 },
  })

  const { data: rawRecipients } = useReadContract({
    address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'getRecipients',
    args: splitId ? [splitId] : undefined, chainId,
    query: { enabled: !!contractAddr && idValid },
  })

  const { data: rawPending } = useReadContract({
    address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'getPendingChange',
    args: splitId ? [splitId] : undefined, chainId,
    query: { enabled: !!contractAddr && idValid, refetchInterval: 10_000 },
  })

  // Live preview (debounced)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const parsedAmount = parseUsdc(amount)
  const [preview, setPreview] = useState<[`0x${string}`[], bigint[]] | null>(null)

  const { refetch: refetchPreview } = useReadContract({
    address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'previewPayment',
    args: splitId && parsedAmount ? [splitId, parsedAmount] : undefined, chainId,
    query: { enabled: false },
  })

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!parsedAmount || !idValid) { setPreview(null); return }
    debounceRef.current = setTimeout(async () => {
      try {
        const { data } = await refetchPreview()
        if (data) setPreview(data as [`0x${string}`[], bigint[]])
      } catch { /* ignore */ }
    }, 300)
  }, [amount, idValid, refetchPreview])

  const split = rawSplit as { version: number; label: string; creator: `0x${string}`; controller: `0x${string}` } | undefined
  const [pendingAccs, , pendingEta] = rawPending
    ? (rawPending as [`0x${string}`[], number[], bigint])
    : [[], [], 0n]
  const [recipAccs, recipBps] = rawRecipients
    ? (rawRecipients as [`0x${string}`[], number[]])
    : [[], []]

  const now = Math.floor(Date.now() / 1000)
  const etaNum = Number(pendingEta)
  const hasPending = pendingEta > 0n
  const pendingReady = hasPending && now >= etaNum
  const pendingIn10min = hasPending && !pendingReady && etaNum - now <= 600

  // Version check
  const linkVersion = initVersion ? parseInt(initVersion) : undefined
  const currentVersion = split?.version
  const versionMismatch = linkVersion !== undefined && currentVersion !== undefined && linkVersion !== currentVersion
  const [versionConfirmed, setVersionConfirmed] = useState(false)

  const [changeConfirmed, setChangeConfirmed] = useState(false)
  const requiresChangeConfirm = (pendingReady || pendingIn10min) && !changeConfirmed

  // ── Submit ──────────────────────────────────────────────────────────────────
  const { writeContractAsync } = useWriteContract()
  const { isLoading: confirming, data: receipt } = useWaitForTransactionReceipt({ hash })

  const memoError = validateMemo(memo)
  const amountError = amount && !parsedAmount ? 'Enter a valid amount (up to 18 decimals)' : null
  const amountZeroError = amount && parsedAmount === 0n ? 'Amount must be greater than zero' : null

  const canSubmit =
    !!parsedAmount && parsedAmount > 0n &&
    !memoError && !amountError &&
    !submitting && !confirming && !!walletAddr &&
    !!contractAddr && idValid &&
    (!versionMismatch || versionConfirmed) &&
    !requiresChangeConfirm

  async function handlePay() {
    if (!canSubmit || !splitId) return
    setTxError('')
    setSubmitting(true)
    const tid = toast.pending('Sending payment…')
    try {
      await ensureReady()
      const txHash = await writeContractAsync({
        address: net.address!,
        abi: USDC_SPLIT_ABI,
        functionName: 'payAtVersion',
        args: [splitId, memo, currentVersion!],
        value: parsedAmount,
        maxFeePerGas: parseGwei('20'),
        chainId: net.chain.id,
      })
      setHash(txHash)
      toast.confirmed(tid, txHash, 'Payment confirmed')
    } catch (e) {
      const msg = decodeContractError(e)
      if (msg) setTxError(msg)
      toast.failed(tid, e)
    } finally {
      setSubmitting(false)
    }
  }

  // Parse Credited events from receipt
  useEffect(() => {
    if (!receipt) return
    const lines: CreditedLine[] = []
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: USDC_SPLIT_ABI, data: log.data, topics: log.topics })
        if (ev.eventName === 'Credited') {
          const { account, amount: amt } = ev.args as { account: `0x${string}`; amount: bigint }
          lines.push({ account, amount: amt })
        }
      } catch { /* not our event */ }
    }
    setCreditedLines(lines)
  }, [receipt])

  // ── Reference check ─────────────────────────────────────────────────────────
  const [checkMemo, setCheckMemo] = useState('')
  const [checkExpected, setCheckExpected] = useState('')
  const [refResults, setRefResults] = useState<{ payer: string; amount: bigint; ts?: number; version: number }[]>([])
  const [refLoading, setRefLoading] = useState(false)
  const [refError, setRefError] = useState('')

  async function checkReference() {
    if (!client || !contractAddr || !net.deploymentBlock || !splitId || !checkMemo) return
    setRefLoading(true)
    setRefError('')
    setRefResults([])
    try {
      const head = await client.getBlockNumber()
      const memoHash = keccak256(toBytes(checkMemo))
      const abiEvent = USDC_SPLIT_ABI.find(e => e.type === 'event' && 'name' in e && e.name === 'Paid')!
      const logs = await fetchLogsChunked(client, {
        address: contractAddr,
        event: abiEvent,
        args: { id: splitId, memoHash },
        fromBlock: net.deploymentBlock,
        toBlock: head,
      })
      const rows = logs.map(l => {
        const a = l.args as { payer: string; amount: bigint; version: number }
        return { payer: a.payer, amount: a.amount, version: a.version }
      })
      setRefResults(rows)
    } catch (e) {
      setRefError(decodeContractError(e) || 'Failed to check')
    } finally {
      setRefLoading(false)
    }
  }

  const refTotal = refResults.reduce((s, r) => s + r.amount, 0n)
  const parsedExpected = checkExpected ? parseUsdc(checkExpected) : null

  // ── Not found ────────────────────────────────────────────────────────────────
  if (!contractAddr) return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center text-slate-500">Not deployed on this network yet.</div>
  )
  if (splitId === null || (splitCount !== undefined && splitId > (splitCount))) return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      <h2 className="font-display text-xl font-semibold mb-2">Split not found</h2>
      <Btn onClick={() => { window.location.hash = `#/${netKey}/` }}>Back to home</Btn>
    </div>
  )
  if (!split) return <div className="flex justify-center py-16"><Spinner size={32} /></div>

  const isImmutable = split.controller === '0x0000000000000000000000000000000000000000'

  // ── Receipt ──────────────────────────────────────────────────────────────────
  if (receipt && creditedLines.length > 0) {
    return (
      <div className="max-w-xl mx-auto px-4 py-10 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 bg-green-50 dark:bg-green-950 rounded-full flex items-center justify-center mx-auto">
            <Check size={28} className="text-green-500" />
          </div>
          <h2 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100">Payment confirmed</h2>
          <a href={explorerTx(net, hash!)} target="_blank" rel="noopener" className="text-sm text-accent-600 hover:underline">
            View transaction
          </a>
        </div>
        <Card className="p-5 space-y-3">
          <h3 className="font-semibold text-slate-800 dark:text-slate-200 text-sm">Credits applied</h3>
          {creditedLines.map(l => (
            <div key={l.account} className="flex justify-between text-sm">
              <span className="font-mono text-slate-500">{shortAddr(l.account)}</span>
              <span className="font-mono tabular text-accent-600">{formatUsdc(l.amount)} USDC</span>
            </div>
          ))}
        </Card>
        <Btn variant="secondary" className="w-full" onClick={() => { window.location.hash = `#/${netKey}/split/${id}` }}>
          View split #{id}
        </Btn>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-10 space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight mb-1">
          Pay split #{id}
        </h1>
        <p className="text-slate-500 text-sm">
          {split.label ? <span>"{sanitiseText(split.label)}"</span> : 'Unlabelled split'}
          {' · set by '}
          <span className="font-mono text-xs">{shortAddr(split.creator)}</span>
          {' · '}
          <Badge color={isImmutable ? 'green' : 'blue'}>
            {isImmutable ? 'Immutable' : `Managed · v${split.version}`}
          </Badge>
        </p>
      </div>

      {/* Pending change warning */}
      {(pendingReady || pendingIn10min) && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 text-sm font-medium">
            <AlertTriangle size={15} />
            {pendingReady
              ? 'A recipient change is ready to be applied — shares may change before your payment lands.'
              : `Shares can change in under 10 minutes.`}
          </div>
          {!changeConfirmed && (
            <Btn size="sm" variant="secondary" onClick={() => setChangeConfirmed(true)}>
              I understand — continue
            </Btn>
          )}
        </div>
      )}

      {/* Version mismatch */}
      {versionMismatch && !versionConfirmed && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-4 space-y-2">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300 text-sm font-medium">
            <AlertCircle size={15} />
            The shares changed since this link was created (v{linkVersion} → v{currentVersion}).
          </div>
          <p className="text-xs text-amber-600">Review the current recipients below, then confirm you're happy to proceed.</p>
          <Btn size="sm" variant="secondary" onClick={() => setVersionConfirmed(true)}>
            I've reviewed the shares — continue
          </Btn>
        </div>
      )}

      {/* Ignored params */}
      {(amountIgnored || memoIgnored) && (
        <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-xs text-slate-500 space-y-1">
          {amountIgnored && <p>Amount from link was invalid — enter it below.</p>}
          {memoIgnored && <p>Memo from link was too long (over 128 bytes) — enter it below.</p>}
        </div>
      )}

      {/* Recipients table */}
      <Card className="p-5 space-y-3">
        <h2 className="font-display font-semibold text-slate-800 dark:text-slate-200 text-sm">Recipients</h2>
        <div className="space-y-1.5">
          {recipAccs.map((acc, i) => (
            <div key={acc} className="flex items-center justify-between text-sm">
              <span className="font-mono text-xs text-slate-500">{shortAddr(acc)}</span>
              <span className="font-mono tabular text-slate-700 dark:text-slate-300">
                {((recipBps[i] ?? 0) / 100).toFixed(2)}%
                {preview && preview[0].includes(acc)
                  ? <span className="text-accent-600 ml-2">{formatUsdc(preview[1][preview[0].indexOf(acc)])}</span>
                  : null}
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400">
          The first recipient receives the rounding remainder (under 1e-16 USDC).
        </p>
      </Card>

      {/* Amount + memo */}
      <Card className="p-5 space-y-4">
        <div className="relative">
          <Input
            label="Amount (USDC)"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            error={amountError || amountZeroError || undefined}
            className="pr-16 font-mono tabular text-xl"
          />
          <span className="absolute right-4 top-[38px] text-slate-400 text-sm pointer-events-none">USDC</span>
        </div>

        {/* Live preview */}
        {preview !== null && parsedAmount !== null && parsedAmount > 0n && (
          <div className="bg-slate-50 dark:bg-slate-800 rounded-xl px-4 py-3 space-y-1">
            <p className="text-xs font-medium text-slate-500 mb-2">Who gets what</p>
            {preview[0].map((acc, i) => (
              <div key={acc} className="flex justify-between text-sm">
                <span className="font-mono text-xs text-slate-500">{shortAddr(acc)}</span>
                <span className="font-mono tabular text-accent-600">{formatUsdc(preview[1][i])}</span>
              </div>
            ))}
          </div>
        )}

        <Input
          label="Memo (optional)"
          placeholder="e.g. INV-2026-001"
          value={memo}
          onChange={e => setMemo(e.target.value)}
          error={memoError || undefined}
          hint={`${new TextEncoder().encode(memo).length}/128 bytes · Anyone can attach any memo; this is not a receipt.`}
        />
      </Card>

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

      <Btn
        size="lg"
        className="w-full"
        onClick={handlePay}
        loading={submitting || confirming || switching}
        disabled={!canSubmit}
      >
        {!walletAddr ? 'Connect wallet first' : `Pay ${amount ? `${amount} USDC` : ''}`}
      </Btn>

      {/* Reference checker */}
      <Card className="p-5 space-y-4">
        <h2 className="font-display font-semibold text-slate-800 dark:text-slate-200 text-sm">Check a reference</h2>
        <p className="text-xs text-slate-400">Look up all payments that used a specific memo on this split.</p>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Memo / reference"
            value={checkMemo}
            onChange={e => setCheckMemo(e.target.value)}
            className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
          <Btn size="sm" loading={refLoading} disabled={!checkMemo || refLoading} onClick={checkReference}>
            Check
          </Btn>
        </div>
        <Input
          placeholder="Expected total (optional)"
          value={checkExpected}
          onChange={e => setCheckExpected(e.target.value)}
          hint="Compares the sum of all matching payments to this amount."
        />
        {refError && <p className="text-xs text-red-500">{refError}</p>}
        {refResults.length > 0 && (
          <div className="space-y-2">
            {refResults.map((r, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="font-mono text-xs text-slate-500">{shortAddr(r.payer)}</span>
                <span className="font-mono tabular">{formatUsdc(r.amount)} USDC · v{r.version}</span>
              </div>
            ))}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-2 flex justify-between text-sm font-semibold">
              <span>Total</span>
              <span className="font-mono tabular">{formatUsdc(refTotal)} USDC</span>
            </div>
            {parsedExpected !== null && (
              <div className={`text-sm font-medium ${refTotal >= parsedExpected ? 'text-green-600' : 'text-amber-600'}`}>
                {refTotal >= parsedExpected
                  ? 'Paid in full'
                  : `${formatUsdc(refTotal)} of ${checkExpected} USDC`}
              </div>
            )}
            {refResults.length === 0 && (
              <p className="text-xs text-slate-400">No payments found with this memo.</p>
            )}
          </div>
        )}
        {!refLoading && refResults.length === 0 && checkMemo && !refError && !refLoading && (
          <p className="text-xs text-slate-400">No payments found with that memo yet.</p>
        )}
      </Card>
    </div>
  )
}
