import { useState, useEffect, useCallback } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi'
import { parseGwei } from 'viem'
import { useNetwork } from '../hooks/useNetwork'
import { useChainGuard } from '../hooks/useChainGuard'
import { useTxToast } from '../hooks/useTxToast'
import { USDC_SPLIT_ABI } from '../config/abi'
import { Card, Btn, Spinner } from '../components/ui'
import { formatUsdc } from '../utils/format'
import { decodeContractError } from '../utils/errors'
import { fetchLogsChunked } from '../utils/logs'


const PAGE_SIZE = 20

interface IncomeEvent {
  splitId: bigint; paymentNo: bigint; amount: bigint; memo?: string; block: bigint
}

function SplitSummaryRow({
  id, netKey, net, walletAddr, onWithdrawn,
}: {
  id: bigint; netKey: string
  net: ReturnType<typeof import('../hooks/useNetwork').useNetwork>['net']
  walletAddr: `0x${string}`
  onWithdrawn: () => void
}) {
  const { ensureReady } = useChainGuard(net)
  const toast = useTxToast(net)
  const { writeContractAsync } = useWriteContract()
  const [hash, setHash] = useState<`0x${string}` | undefined>()
  const { isSuccess } = useWaitForTransactionReceipt({ hash })
  useEffect(() => { if (isSuccess) onWithdrawn() }, [isSuccess, onWithdrawn])

  const contractAddr = net.address
  const chainId = net.chain.id

  const { data: rawSplit } = useReadContract({
    address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'getSplit',
    args: [id], chainId, query: { refetchInterval: 15_000 },
  })
  const { data: rawAcct, refetch } = useReadContract({
    address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'getAccount',
    args: [id, walletAddr], chainId, query: { refetchInterval: 15_000 },
  })

  useEffect(() => { if (isSuccess) refetch() }, [isSuccess, refetch])

  if (!rawSplit || !rawAcct) return (
    <tr className="animate-pulse">
      <td colSpan={5}><div className="h-8 bg-slate-100 dark:bg-slate-800 rounded m-2" /></td>
    </tr>
  )

  const s = rawSplit as { label: string; controller: `0x${string}`; totalReceived: bigint }
  const [earned, withdrawn] = rawAcct as [bigint, bigint]
  const withdrawable = earned - withdrawn

  async function withdraw() {
    const tid = toast.pending('Withdrawing…')
    try {
      await ensureReady()
      const h = await writeContractAsync({
        address: net.address!, abi: USDC_SPLIT_ABI, functionName: 'withdraw',
        args: [id], maxFeePerGas: parseGwei('20'), chainId: net.chain.id,
      })
      setHash(h)
      toast.confirmed(tid, h, 'Withdrawn')
    } catch (e) { toast.failed(tid, e) }
  }

  return (
    <tr
      className="border-b border-slate-100 dark:border-slate-800 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
      onClick={() => { window.location.hash = `#/${netKey}/split/${id}` }}
    >
      <td className="px-4 py-3 font-mono text-xs text-slate-400 tabular">#{String(id)}</td>
      <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-300 max-w-[120px] truncate">
        {s.label || <span className="text-slate-400 italic">Unlabelled</span>}
      </td>
      <td className="px-4 py-3 text-sm tabular text-right font-mono">{formatUsdc(earned)}</td>
      <td className="px-4 py-3 text-sm tabular text-right font-mono">{formatUsdc(withdrawn)}</td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
          <span className="font-mono tabular text-sm font-semibold text-accent-600">
            {formatUsdc(withdrawable)}
          </span>
          {withdrawable > 0n && (
            <Btn size="sm" onClick={withdraw}>Withdraw</Btn>
          )}
        </div>
      </td>
    </tr>
  )
}

export function MePage() {
  const { netKey, net } = useNetwork()
  const { address: walletAddr } = useAccount()
  const client = usePublicClient({ chainId: net.chain.id })
  const contractAddr = net.address
  const chainId = net.chain.id

  const [page, setPage] = useState(0)
  const [version, setVersion] = useState(0)

  const { data: totalHeld, refetch: refetchHeld } = useReadContract({
    address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'totalHeld',
    chainId, query: { refetchInterval: 15_000 },
  })

  const { data: recipCount, refetch: refetchCount } = useReadContract({
    address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'recipientSplitCount',
    args: walletAddr ? [walletAddr] : undefined, chainId,
    query: { enabled: !!walletAddr && !!contractAddr, refetchInterval: 15_000 },
  })

  const total = Number(recipCount ?? 0)
  const start = page * PAGE_SIZE
  const pageStart = Math.max(0, total - PAGE_SIZE - start)
  const pageLimit = Math.min(PAGE_SIZE, total - start)

  const { data: pageIds, refetch: refetchPage } = useReadContract({
    address: contractAddr ?? undefined, abi: USDC_SPLIT_ABI, functionName: 'recipientSplitsPage',
    args: walletAddr && total > 0 ? [walletAddr, BigInt(pageStart), BigInt(pageLimit)] : undefined,
    chainId,
    query: { enabled: !!walletAddr && !!contractAddr && total > 0, refetchInterval: 15_000 },
  })

  const ids = pageIds ? [...(pageIds as bigint[])].reverse() : []

  const refetchAll = useCallback(() => {
    refetchCount(); refetchPage(); refetchHeld()
    setVersion(v => v + 1)
  }, [refetchCount, refetchPage, refetchHeld])

  // ── Income history (Credited events) ──────────────────────────────────────
  const [income, setIncome] = useState<IncomeEvent[]>([])
  const [incomeLoading, setIncomeLoading] = useState(false)
  const [incomeError, setIncomeError] = useState('')

  const fetchIncome = useCallback(async () => {
    if (!client || !contractAddr || !net.deploymentBlock || !walletAddr) return
    setIncomeLoading(true)
    setIncomeError('')
    try {
      const head = await client.getBlockNumber()
      const creditedAbi = USDC_SPLIT_ABI.find(e => e.type === 'event' && 'name' in e && e.name === 'Credited')!
      const logs = await fetchLogsChunked(client, {
        address: contractAddr,
        event: creditedAbi,
        args: { account: walletAddr },
        fromBlock: net.deploymentBlock,
        toBlock: head,
      })
      const events: IncomeEvent[] = logs.map(l => {
        const a = l.args as { id: bigint; paymentNo: bigint; amount: bigint }
        return { splitId: a.id, paymentNo: a.paymentNo, amount: a.amount, block: l.blockNumber ?? 0n }
      })
      events.sort((a, b) => (a.block > b.block ? -1 : 1))

      // Fetch memo for each via Paid events (best-effort)
      setIncome(events.slice(0, 50))
    } catch (e) {
      setIncomeError(decodeContractError(e) || 'Failed to load income history')
    } finally {
      setIncomeLoading(false)
    }
  }, [client, contractAddr, net.deploymentBlock, walletAddr])

  const deploymentBlockStr = net.deploymentBlock?.toString() ?? ''
  useEffect(() => {
    if (walletAddr && contractAddr && net.deploymentBlock) {
      void fetchIncome()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddr, contractAddr, deploymentBlockStr, fetchIncome])

  if (!walletAddr) return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center">
      <p className="text-slate-500">Connect your wallet to view your splits.</p>
    </div>
  )

  if (!contractAddr) return (
    <div className="max-w-2xl mx-auto px-4 py-16 text-center text-slate-500">
      Not deployed on this network yet.
    </div>
  )

  return (
    <div className="max-w-3xl mx-auto px-4 py-10 space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">My splits</h1>
        <p className="text-slate-500 text-sm mt-1">Splits where you are or have been a recipient.</p>
      </div>

      {/* Total held in all splits */}
      {totalHeld !== undefined && (
        <Card className="p-5 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Contract total held</p>
            <p className="font-mono tabular text-2xl font-bold text-slate-900 dark:text-slate-100">
              {formatUsdc(totalHeld)} <span className="text-base font-normal text-slate-400">USDC</span>
            </p>
          </div>
        </Card>
      )}

      {/* Splits table */}
      <Card>
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="font-display font-semibold text-slate-800 dark:text-slate-200">
            Your splits
            <span className="text-slate-400 font-normal text-sm ml-2">({total})</span>
          </h2>
        </div>
        {total === 0 ? (
          <p className="text-slate-400 text-sm px-5 py-6 text-center">You're not a recipient on any split yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <th className="px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide">ID</th>
                    <th className="px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide">Label</th>
                    <th className="px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide text-right">Earned</th>
                    <th className="px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide text-right">Withdrawn</th>
                    <th className="px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide text-right">Withdrawable</th>
                  </tr>
                </thead>
                <tbody key={version}>
                  {ids.map(id => (
                    <SplitSummaryRow
                      key={String(id)} id={id} netKey={netKey} net={net}
                      walletAddr={walletAddr} onWithdrawn={refetchAll}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {total > PAGE_SIZE && (
              <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 dark:border-slate-800">
                <Btn variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Btn>
                <span className="text-xs text-slate-400 tabular">
                  {start + 1}–{Math.min(start + PAGE_SIZE, total)} of {total}
                </span>
                <Btn variant="ghost" size="sm" disabled={start + PAGE_SIZE >= total} onClick={() => setPage(p => p + 1)}>Next</Btn>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Income history */}
      <Card>
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-display font-semibold text-slate-800 dark:text-slate-200">Income history</h2>
          <button onClick={fetchIncome} className="text-xs text-accent-600 hover:underline">Refresh</button>
        </div>
        {incomeLoading && <div className="flex justify-center py-8"><Spinner /></div>}
        {incomeError && <p className="text-sm text-amber-600 px-5 py-4">{incomeError}</p>}
        {!incomeLoading && income.length === 0 && <p className="text-sm text-slate-400 px-5 py-4">No income events yet.</p>}
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {income.map((ev, i) => (
            <div key={i} className="px-5 py-3 flex items-center justify-between gap-4">
              <div>
                <a
                  href={`#/${netKey}/split/${ev.splitId}`}
                  className="text-sm font-medium text-accent-600 hover:underline"
                  onClick={e => { e.stopPropagation(); window.location.hash = `#/${netKey}/split/${ev.splitId}` }}
                >
                  Split #{String(ev.splitId)}
                </a>
                <p className="text-xs text-slate-400">payment #{String(ev.paymentNo)} · block {String(ev.block)}</p>
              </div>
              <span className="font-mono tabular text-sm font-semibold text-accent-600">
                +{formatUsdc(ev.amount)} USDC
              </span>
            </div>
          ))}
        </div>
        {income.length === 50 && (
          <p className="text-xs text-slate-400 px-5 py-3">Showing most recent 50 events.</p>
        )}
      </Card>
    </div>
  )
}
