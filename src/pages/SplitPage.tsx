import { useState, useEffect, useCallback } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi'
import { parseGwei } from 'viem'
import { ExternalLink, Copy, Check, AlertCircle, Clock, ArrowRight, Lock } from 'lucide-react'
import { useNetwork } from '../hooks/useNetwork'
import { useChainGuard } from '../hooks/useChainGuard'
import { useTxToast } from '../hooks/useTxToast'
import { USDC_SPLIT_ABI } from '../config/abi'
import { Card, Btn, Badge, Spinner, Addr, ShareBar } from '../components/ui'
import { formatUsdc, shortAddr, formatTs, formatCountdown } from '../utils/format'
import { decodeContractError } from '../utils/errors'
import { fetchLogsChunked } from '../utils/logs'
import { sanitiseText } from '../utils/bidi'
import { explorerTx } from '../config/networks'

// ─── helpers ─────────────────────────────────────────────────────────────────
const ZERO = '0x0000000000000000000000000000000000000000'

function addrIs(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase()
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface SplitData {
  creator: `0x${string}`; controller: `0x${string}`; changeDelay: bigint;
  createdAt: bigint; version: number; pendingEta: bigint;
  totalReceived: bigint; totalWithdrawn: bigint; paymentCount: bigint; label: string;
}
interface RecipientRow {
  account: `0x${string}`; bps: number;
  earned: bigint; withdrawn: bigint; withdrawable: bigint;
}
interface TimelineEvent {
  block: bigint; ts?: number; type: string; data: Record<string, string | bigint | number>
}

// ─── Recipient row component ──────────────────────────────────────────────────
function RecipRow({
  r, id, netKey, net, walletAddr, onReleased,
}: {
  r: RecipientRow; id: bigint; netKey: string
  net: ReturnType<typeof useNetwork>['net']
  walletAddr?: `0x${string}`
  onReleased: () => void
}) {
  const { ensureReady } = useChainGuard(net)
  const toast = useTxToast(net)
  const { writeContractAsync } = useWriteContract()
  const [hash, setHash] = useState<`0x${string}` | undefined>()
  const [busy, setBusy] = useState(false)
  const { isSuccess } = useWaitForTransactionReceipt({ hash })
  useEffect(() => { if (isSuccess) onReleased() }, [isSuccess, onReleased])

  const explorerBase = net.chain.blockExplorers?.default.url ?? ''

  async function release() {
    setBusy(true)
    const tid = toast.pending(`Releasing to ${shortAddr(r.account)}…`)
    try {
      await ensureReady()
      const h = await writeContractAsync({
        address: net.address!, abi: USDC_SPLIT_ABI, functionName: 'release',
        args: [id, r.account], maxFeePerGas: parseGwei('20'), chainId: net.chain.id,
      })
      setHash(h)
      toast.confirmed(tid, h, 'Released')
    } catch (e) {
      toast.failed(tid, e)
    } finally { setBusy(false) }
  }

  const isYou = walletAddr && addrIs(r.account, walletAddr)

  return (
    <tr className="border-b border-slate-100 dark:border-slate-800 last:border-0">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Addr addr={r.account} explorerBase={explorerBase} />
          {isYou && <Badge color="green">you</Badge>}
        </div>
      </td>
      <td className="px-4 py-3 text-sm tabular text-right font-mono">{(r.bps / 100).toFixed(2)}%</td>
      <td className="px-4 py-3 text-sm tabular text-right font-mono">{formatUsdc(r.earned)}</td>
      <td className="px-4 py-3 text-sm tabular text-right font-mono">{formatUsdc(r.withdrawn)}</td>
      <td className="px-4 py-3 text-sm tabular text-right font-mono font-semibold text-accent-600">
        {formatUsdc(r.withdrawable)}
      </td>
      <td className="px-4 py-3 text-right">
        {r.withdrawable > 0n && (
          <Btn size="sm" variant="secondary" loading={busy} onClick={release}>
            Release
          </Btn>
        )}
      </td>
    </tr>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export function SplitPage({ id }: { id: string }) {
  const { netKey, net } = useNetwork()
  const { address: walletAddr } = useAccount()
  const { ensureReady, onCorrectChain } = useChainGuard(net)
  const toast = useTxToast(net)
  const client = usePublicClient({ chainId: net.chain.id })

  const splitId = /^[1-9]\d*$/.test(id) ? BigInt(id) : null
  const contractAddr = net.address
  const chainId = net.chain.id
  const explorerBase = net.chain.blockExplorers?.default.url ?? ''

  // ── Contract reads ─────────────────────────────────────────────────────────
  const { data: splitCount } = useReadContract({
    address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'splitCount',
    chainId, query: { enabled: !!contractAddr },
  })

  const idValid = splitId !== null && splitCount !== undefined && splitId <= (splitCount) && splitId > 0n

  const { data: rawSplit, refetch: refetchSplit } = useReadContract({
    address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'getSplit',
    args: splitId ? [splitId] : undefined, chainId,
    query: { enabled: !!contractAddr && idValid, refetchInterval: 15_000 },
  })

  const { data: rawRecipients, refetch: refetchRecipients } = useReadContract({
    address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'getRecipients',
    args: splitId ? [splitId] : undefined, chainId,
    query: { enabled: !!contractAddr && idValid, refetchInterval: 15_000 },
  })

  const { data: rawPending, refetch: refetchPending } = useReadContract({
    address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'getPendingChange',
    args: splitId ? [splitId] : undefined, chainId,
    query: { enabled: !!contractAddr && idValid, refetchInterval: 5_000 },
  })

  const { data: myWithdrawable, refetch: refetchMy } = useReadContract({
    address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'withdrawable',
    args: splitId && walletAddr ? [splitId, walletAddr] : undefined, chainId,
    query: { enabled: !!contractAddr && idValid && !!walletAddr, refetchInterval: 15_000 },
  })

  const refetchAll = useCallback(() => {
    refetchSplit(); refetchRecipients(); refetchPending(); refetchMy()
  }, [refetchSplit, refetchRecipients, refetchPending, refetchMy])

  // ── Typed data ─────────────────────────────────────────────────────────────
  const split = rawSplit
  const [recipAccs, recipBps] = rawRecipients
    ? (rawRecipients as [`0x${string}`[], number[]])
    : [[], []]
  const [pendingAccs, pendingBps, pendingEta] = rawPending
    ? (rawPending as [`0x${string}`[], number[], bigint])
    : [[], [], 0n]

  // Per-recipient account data via individual reads
  const { data: acct0 } = useReadContract({ address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'getAccount', args: splitId && recipAccs[0] ? [splitId, recipAccs[0]] : undefined, chainId, query: { enabled: !!contractAddr && idValid && recipAccs.length > 0, refetchInterval: 15_000 } })
  const { data: acct1 } = useReadContract({ address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'getAccount', args: splitId && recipAccs[1] ? [splitId, recipAccs[1]] : undefined, chainId, query: { enabled: !!contractAddr && idValid && recipAccs.length > 1, refetchInterval: 15_000 } })
  const { data: acct2 } = useReadContract({ address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'getAccount', args: splitId && recipAccs[2] ? [splitId, recipAccs[2]] : undefined, chainId, query: { enabled: !!contractAddr && idValid && recipAccs.length > 2, refetchInterval: 15_000 } })
  const { data: acct3 } = useReadContract({ address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'getAccount', args: splitId && recipAccs[3] ? [splitId, recipAccs[3]] : undefined, chainId, query: { enabled: !!contractAddr && idValid && recipAccs.length > 3, refetchInterval: 15_000 } })
  const { data: acct4 } = useReadContract({ address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'getAccount', args: splitId && recipAccs[4] ? [splitId, recipAccs[4]] : undefined, chainId, query: { enabled: !!contractAddr && idValid && recipAccs.length > 4, refetchInterval: 15_000 } })

  const acctArr = [acct0, acct1, acct2, acct3, acct4]

  // Build recipient rows for first 5 (good enough for most splits)
  const recipientRows: RecipientRow[] = recipAccs.slice(0, 5).map((acc, i) => {
    const a = acctArr[i] as [bigint, bigint] | undefined
    const earned = a ? a[0] : 0n
    const withdrawn = a ? a[1] : 0n
    return { account: acc, bps: recipBps[i] ?? 0, earned, withdrawn, withdrawable: earned - withdrawn }
  })

  // ── Tx helpers ─────────────────────────────────────────────────────────────
  const { writeContractAsync } = useWriteContract()
  const [pendingHash, setPendingHash] = useState<`0x${string}` | undefined>()
  const { isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: pendingHash })
  useEffect(() => { if (txSuccess) refetchAll() }, [txSuccess, refetchAll])

  async function writeTx(fn: string, args: unknown[], msg: string) {
    const tid = toast.pending(msg)
    try {
      await ensureReady()
      const h = await writeContractAsync({
        address: net.address!, abi: USDC_SPLIT_ABI, functionName: fn as 'withdraw',
        args: args as unknown as readonly [bigint],
        maxFeePerGas: parseGwei('20'), chainId: net.chain.id,
      })
      setPendingHash(h)
      toast.confirmed(tid, h, 'Confirmed')
    } catch (e) { toast.failed(tid, e) }
  }

  // ── Timeline ───────────────────────────────────────────────────────────────
  const [timeline, setTimeline] = useState<TimelineEvent[]>([])
  const [tlLoading, setTlLoading] = useState(false)
  const [tlError, setTlError] = useState('')

  const fetchTimeline = useCallback(async () => {
    if (!client || !contractAddr || !net.deploymentBlock || !splitId) return
    setTlLoading(true)
    setTlError('')
    try {
      const head = await client.getBlockNumber()
      const events: TimelineEvent[] = []

      const allEvents = [
        'SplitCreated', 'Paid', 'Credited', 'Withdrawn', 'TransferSkipped',
        'ChangeProposed', 'ChangeCancelled', 'ChangeExecuted', 'SplitLocked',
      ]

      for (const evName of allEvents) {
        const abiEvent = USDC_SPLIT_ABI.find(
          (e): e is typeof e & { type: 'event'; name: string } =>
            e.type === 'event' && 'name' in e && e.name === evName
        )
        if (!abiEvent) continue
        try {
          const logs = await fetchLogsChunked(client, {
            address: contractAddr,
            event: abiEvent,
            args: { id: splitId },
            fromBlock: net.deploymentBlock,
            toBlock: head,
          })
          for (const log of logs) {
            const data: Record<string, string | bigint | number> = {}
            if (log.args) {
              for (const [k, v] of Object.entries(log.args)) {
                data[k] = v as string | bigint | number
              }
            }
            events.push({ block: log.blockNumber ?? 0n, type: evName, data })
          }
        } catch { /* skip this event type */ }
      }

      // Sort by block desc
      events.sort((a, b) => (a.block > b.block ? -1 : a.block < b.block ? 1 : 0))
      setTimeline(events)
    } catch (e) {
      setTlError(decodeContractError(e) || 'Failed to load timeline')
    } finally {
      setTlLoading(false)
    }
  }, [client, contractAddr, net.deploymentBlock, splitId])

  useEffect(() => { if (idValid && contractAddr && splitId) fetchTimeline() }, [idValid, contractAddr, splitId?.toString()])

  // ── Copy pay link ──────────────────────────────────────────────────────────
  const [copied, setCopied] = useState(false)
  function copyPayLink() {
    const url = `${window.location.origin}${window.location.pathname}#/${netKey}/pay/${id}?v=${split?.version ?? 1}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // ── Controller panel state ─────────────────────────────────────────────────
  const [showPropose, setShowPropose] = useState(false)
  const [showLockConfirm, setShowLockConfirm] = useState(false)

  // ── Not found ──────────────────────────────────────────────────────────────
  if (!contractAddr) return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center text-slate-500">
      Not deployed on this network yet.
    </div>
  )

  if (splitId === null || (splitCount !== undefined && splitId > (splitCount))) return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <h2 className="font-display text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2">Split not found</h2>
      <p className="text-slate-500 text-sm">ID #{id} doesn't exist yet.</p>
      <Btn className="mt-6" onClick={() => { window.location.hash = `#/${netKey}/` }}>
        Back to home
      </Btn>
    </div>
  )

  if (!split) return (
    <div className="max-w-2xl mx-auto px-4 py-16 flex justify-center"><Spinner size={32} /></div>
  )

  const isController = walletAddr && addrIs(split.controller, walletAddr) && !addrIs(split.controller, ZERO)
  const isImmutable = addrIs(split.controller, ZERO)
  const held = split.totalReceived - split.totalWithdrawn
  const now = Math.floor(Date.now() / 1000)
  const etaNum = Number(pendingEta)
  const hasPending = pendingEta > 0n
  const pendingReady = hasPending && now >= etaNum
  const pendingExpired = hasPending && now > etaNum + 7 * 86400
  const pendingIn10min = hasPending && !pendingReady && etaNum - now <= 600

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-xs text-slate-400">#{id}</span>
            <Badge color={isImmutable ? 'green' : 'blue'}>
              {isImmutable ? 'Immutable' : `Managed · v${split.version}`}
            </Badge>
          </div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
            {split.label
              ? sanitiseText(split.label)
              : <span className="text-slate-400 italic font-normal">Unlabelled split</span>}
          </h1>
          {!isImmutable && (
            <p className="text-xs text-slate-400 mt-1">
              Managed by <span className="font-mono">{shortAddr(split.controller)}</span>
              {' · changes wait '}{formatCountdown(Number(split.changeDelay))}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={copyPayLink}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            Pay link
          </button>
          <a
            href={`${explorerBase}/address/${contractAddr}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            <ExternalLink size={14} />
            Explorer
          </a>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total received', value: formatUsdc(split.totalReceived) + ' USDC' },
          { label: 'Total withdrawn', value: formatUsdc(split.totalWithdrawn) + ' USDC' },
          { label: 'Held', value: formatUsdc(held) + ' USDC' },
          { label: 'Payments', value: String(split.paymentCount) },
        ].map(({ label, value }) => (
          <Card key={label} className="p-4">
            <p className="text-xs text-slate-400 mb-1">{label}</p>
            <p className="font-mono tabular text-sm font-semibold text-slate-800 dark:text-slate-200">{value}</p>
          </Card>
        ))}
      </div>

      {/* Pending change banner */}
      {hasPending && (
        <div className={`rounded-2xl border p-4 space-y-2 ${
          pendingExpired
            ? 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'
            : pendingReady
              ? 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800'
              : 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800'
        }`}>
          <div className="flex items-center gap-2">
            <Clock size={15} />
            <span className="font-semibold text-sm">
              {pendingExpired ? 'Pending change expired' : pendingReady ? 'Change ready to apply' : 'Change pending'}
            </span>
          </div>
          {!pendingExpired && (
            <p className="text-xs">
              {pendingReady
                ? 'Anyone can apply this change now.'
                : `Becomes ready ${formatCountdown(etaNum - now)} · expires ${formatCountdown(etaNum + 7 * 86400 - now)} after`}
            </p>
          )}
          {pendingIn10min && !pendingReady && (
            <p className="text-xs font-medium text-amber-700">Shares can change in under 10 minutes — confirm before paying.</p>
          )}
          <div className="text-xs space-y-0.5">
            <p className="font-medium">Proposed recipients:</p>
            {pendingAccs.map((a, i) => (
              <div key={a} className="flex items-center gap-2">
                <span className="font-mono">{shortAddr(a)}</span>
                <ArrowRight size={10} className="text-slate-400" />
                <span className="tabular">{((pendingBps[i] ?? 0) / 100).toFixed(2)}%</span>
              </div>
            ))}
          </div>
          {pendingReady && !pendingExpired && (
            <Btn size="sm" onClick={() => writeTx('executeChange', [splitId], 'Applying change…')}>
              Apply change
            </Btn>
          )}
          {pendingExpired && <p className="text-xs text-red-600">Expired — controller must propose again.</p>}
        </div>
      )}

      {/* Recipients */}
      <Card>
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="font-display font-semibold text-slate-800 dark:text-slate-200">Recipients</h2>
        </div>
        <div className="px-5 pt-3 pb-1">
          <ShareBar bpsArray={recipBps.map(Number)} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                <th className="px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide">Address</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide text-right">Share</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide text-right">Earned</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide text-right">Withdrawn</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide text-right">Withdrawable</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {recipientRows.map(r => (
                <RecipRow
                  key={r.account} r={r} id={splitId}
                  netKey={netKey} net={net} walletAddr={walletAddr}
                  onReleased={refetchAll}
                />
              ))}
              {recipAccs.length > 5 && (
                <tr>
                  <td colSpan={6} className="px-4 py-2 text-xs text-slate-400">
                    + {recipAccs.length - 5} more recipients (use Release or Distribute)
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Withdraw for connected wallet */}
        {walletAddr && myWithdrawable !== undefined && (myWithdrawable) > 0n && (
          <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Your withdrawable: <span className="font-mono tabular text-accent-600">{formatUsdc(myWithdrawable)} USDC</span>
              </p>
            </div>
            <Btn onClick={() => writeTx('withdraw', [splitId], 'Withdrawing…')}>
              Withdraw
            </Btn>
          </div>
        )}
        {/* Distribute */}
        <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800">
          <Btn
            variant="secondary"
            onClick={() => writeTx('distribute', [splitId], 'Distributing to all…')}
          >
            Distribute to all
          </Btn>
          <p className="text-xs text-slate-400 mt-1.5">
            Pushes each current recipient's balance. Recipients that cannot receive are skipped — their credit stays safe.
          </p>
        </div>
      </Card>

      {/* Controller panel */}
      {isController && (
        <Card className="p-5 space-y-4">
          <h2 className="font-display font-semibold text-slate-800 dark:text-slate-200">Controller panel</h2>
          <div className="flex flex-wrap gap-2">
            <Btn variant="secondary" size="sm" onClick={() => setShowPropose(p => !p)}>
              {showPropose ? 'Cancel' : (hasPending ? 'Re-propose change' : 'Propose change')}
            </Btn>
            {hasPending && (
              <Btn variant="ghost" size="sm" onClick={() => writeTx('cancelChange', [splitId], 'Cancelling…')}>
                Cancel pending change
              </Btn>
            )}
            <Btn variant="danger" size="sm" onClick={() => setShowLockConfirm(true)}>
              <Lock size={13} /> Lock split
            </Btn>
          </div>

          {showLockConfirm && (
            <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl p-4 space-y-3">
              <p className="text-sm text-red-700 dark:text-red-300 font-medium">
                Lock this split forever? The controller address will be removed and no further changes can be proposed. This is irreversible.
              </p>
              <div className="flex gap-2">
                <Btn variant="danger" size="sm" onClick={() => { setShowLockConfirm(false); writeTx('lockSplit', [splitId], 'Locking split…') }}>
                  Confirm — lock forever
                </Btn>
                <Btn variant="ghost" size="sm" onClick={() => setShowLockConfirm(false)}>Never mind</Btn>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Pay CTA */}
      <Card className="p-5 flex items-center justify-between gap-4">
        <div>
          <p className="font-semibold text-slate-800 dark:text-slate-200">Pay into this split</p>
          <p className="text-sm text-slate-400">Send USDC — it's credited instantly to all recipients.</p>
        </div>
        <Btn onClick={() => { window.location.hash = `#/${netKey}/pay/${id}` }}>
          Pay
        </Btn>
      </Card>

      {/* Timeline */}
      <Card>
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-display font-semibold text-slate-800 dark:text-slate-200">Timeline</h2>
          <button onClick={fetchTimeline} className="text-xs text-accent-600 hover:underline">
            Refresh
          </button>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {tlLoading && <div className="flex justify-center py-8"><Spinner /></div>}
          {tlError && (
            <div className="px-5 py-4 flex items-center gap-2 text-amber-600 text-sm">
              <AlertCircle size={15} />
              Timeline may be incomplete — {tlError}
              <button onClick={fetchTimeline} className="underline ml-1">Retry</button>
            </div>
          )}
          {!tlLoading && timeline.length === 0 && !tlError && (
            <p className="text-sm text-slate-400 px-5 py-4">No events yet.</p>
          )}
          {timeline.map((ev, i) => (
            <TimelineRow key={i} ev={ev} explorerBase={explorerBase} netKey={netKey} id={id} />
          ))}
        </div>
      </Card>
    </div>
  )
}

function TimelineRow({
  ev, explorerBase, netKey, id,
}: {
  ev: TimelineEvent; explorerBase: string; netKey: string; id: string
}) {
  const d = ev.data
  let icon = '●', summary = ev.type, detail = ''

  switch (ev.type) {
    case 'SplitCreated':
      icon = '+'; summary = `Split #${id} created`; break
    case 'Paid': {
      const amt = formatUsdc(d.amount as bigint)
      const memo = d.memo ? sanitiseText(String(d.memo)) : ''
      summary = `Paid ${amt} USDC`
      if (memo) detail = `Memo: ${memo}`
      icon = '→'
      break
    }
    case 'Withdrawn': {
      const amt = formatUsdc(d.amount as bigint)
      const caller = shortAddr(String(d.caller))
      summary = `Withdrawn ${amt} USDC`
      detail = addrIs(String(d.account), String(d.caller)) ? '' : `by ${caller}`
      icon = '↑'
      break
    }
    case 'TransferSkipped': {
      summary = `Push failed for ${shortAddr(String(d.account))} — can still withdraw or release`
      icon = '!'
      break
    }
    case 'ChangeProposed':
      summary = 'Change proposed'
      detail = `ETA: ${formatTs(Number(d.eta))}`
      icon = '⟳'
      break
    case 'ChangeCancelled':
      summary = 'Change cancelled'; icon = '✕'; break
    case 'ChangeExecuted':
      summary = `Change applied, version ${d.version}`; icon = '✓'; break
    case 'SplitLocked':
      summary = 'Split locked — immutable from now on'; icon = '🔒'; break
  }

  return (
    <div className="px-5 py-3 flex gap-3">
      <span className="text-slate-300 text-sm w-4 shrink-0 mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-700 dark:text-slate-300">{summary}</p>
        {detail && <p className="text-xs text-slate-400 mt-0.5 truncate">{detail}</p>}
      </div>
      <span className="font-mono text-xs text-slate-400 tabular shrink-0 mt-0.5">#{String(ev.block)}</span>
    </div>
  )
}
