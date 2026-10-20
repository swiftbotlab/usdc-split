import { useState } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { ArrowRight, Plus, Users, Zap } from 'lucide-react'
import { useNetwork } from '../hooks/useNetwork'
import { USDC_SPLIT_ABI } from '../config/abi'
import { Card, Btn, Spinner, Badge } from '../components/ui'
import { formatUsdc } from '../utils/format'

const PAGE_SIZE = 20

// ─── Mini split row (reused on Home + Me) ───────────────────────────────────
function SplitRow({ id, netKey }: { id: bigint; netKey: string }) {
  const { net } = useNetwork()
  const address = net.address!
  const chainId = net.chain.id
  const { address: walletAddr } = useAccount()

  const { data: splitData } = useReadContract({
    address, abi: USDC_SPLIT_ABI, functionName: 'getSplit',
    args: [id], chainId,
  })
  const { data: recipients } = useReadContract({
    address, abi: USDC_SPLIT_ABI, functionName: 'getRecipients',
    args: [id], chainId,
  })
  const { data: myW } = useReadContract({
    address, abi: USDC_SPLIT_ABI, functionName: 'withdrawable',
    args: walletAddr ? [id, walletAddr] : undefined,
    chainId,
    query: { enabled: !!walletAddr },
  })

  if (!splitData) return (
    <tr className="animate-pulse">
      <td colSpan={5}><div className="h-8 bg-slate-100 dark:bg-slate-800 rounded m-2" /></td>
    </tr>
  )

  const s = splitData as {
    label: string; controller: `0x${string}`; version: number;
    totalReceived: bigint; totalWithdrawn: bigint;
  }
  const isManaged = s.controller !== '0x0000000000000000000000000000000000000000'
  const held = s.totalReceived - s.totalWithdrawn

  return (
    <tr
      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer border-b border-slate-100 dark:border-slate-800 last:border-0"
      onClick={() => { window.location.hash = `#/${netKey}/split/${id}` }}
    >
      <td className="px-4 py-3 font-mono text-xs text-slate-500 tabular">#{String(id)}</td>
      <td className="px-4 py-3 text-sm font-medium text-slate-800 dark:text-slate-200 max-w-[140px] truncate">
        {s.label || <span className="text-slate-400 italic">Unlabelled</span>}
      </td>
      <td className="px-4 py-3 text-sm text-slate-500">
        {recipients ? (recipients as [string[], number[]])[0].length : '–'} recipients
      </td>
      <td className="px-4 py-3 text-sm tabular text-right font-mono">
        {formatUsdc(held)} USDC
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
          {myW !== undefined && (myW) > 0n && (
            <span className="text-xs font-mono text-accent-600 tabular">
              {formatUsdc(myW)}
            </span>
          )}
          <Badge color={isManaged ? 'blue' : 'green'}>
            {isManaged ? 'Managed' : 'Immutable'}
          </Badge>
        </div>
      </td>
    </tr>
  )
}

// ─── Splits table ─────────────────────────────────────────────────────────────
function SplitsTable({
  ids,
  netKey,
  caption,
}: {
  ids: bigint[]
  netKey: string
  caption: string
}) {
  const [page, setPage] = useState(0)
  const start = page * PAGE_SIZE
  const slice = ids.slice(start, start + PAGE_SIZE)

  if (ids.length === 0) return (
    <p className="text-sm text-slate-400 py-4 text-center">{caption} — none yet</p>
  )

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800">
              <th className="px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide">ID</th>
              <th className="px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide">Label</th>
              <th className="px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide">Recipients</th>
              <th className="px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide text-right">Held</th>
              <th className="px-4 py-2 text-xs font-medium text-slate-400 uppercase tracking-wide text-right">My withdrawable</th>
            </tr>
          </thead>
          <tbody>
            {slice.map(id => <SplitRow key={String(id)} id={id} netKey={netKey} />)}
          </tbody>
        </table>
      </div>
      {ids.length > PAGE_SIZE && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 dark:border-slate-800">
          <Btn variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
            Previous
          </Btn>
          <span className="text-xs text-slate-400 tabular">
            {start + 1}–{Math.min(start + PAGE_SIZE, ids.length)} of {ids.length}
          </span>
          <Btn variant="ghost" size="sm" disabled={start + PAGE_SIZE >= ids.length} onClick={() => setPage(p => p + 1)}>
            Next
          </Btn>
        </div>
      )}
    </div>
  )
}

// ─── Home page ────────────────────────────────────────────────────────────────
export function Home() {
  const { netKey, net } = useNetwork()
  const { address: walletAddr } = useAccount()
  const [openId, setOpenId] = useState('')

  const chainId = net.chain.id
  const contractAddr = net.address

  // Created by this wallet
  const { data: createdIds, isLoading: loadingCreated } = useReadContract({
    address: contractAddr ?? undefined,
    abi: USDC_SPLIT_ABI,
    functionName: 'splitsByCreator',
    args: walletAddr ? [walletAddr] : undefined,
    chainId,
    query: { enabled: !!walletAddr && !!contractAddr, refetchInterval: 15_000 },
  })

  // Splits this wallet is a recipient of
  const { data: recipientCount } = useReadContract({
    address: contractAddr ?? undefined,
    abi: USDC_SPLIT_ABI,
    functionName: 'recipientSplitCount',
    args: walletAddr ? [walletAddr] : undefined,
    chainId,
    query: { enabled: !!walletAddr && !!contractAddr, refetchInterval: 15_000 },
  })

  const recipientTotal = Number(recipientCount ?? 0)
  const pages = Math.ceil(recipientTotal / PAGE_SIZE)
  const recipientPageIds: bigint[] = []

  // Fetch all pages of recipient splits (newest first by reversing)
  const { data: recipientPage0 } = useReadContract({
    address: contractAddr ?? undefined,
    abi: USDC_SPLIT_ABI,
    functionName: 'recipientSplitsPage',
    args: walletAddr && recipientTotal > 0
      ? [walletAddr, BigInt(Math.max(0, recipientTotal - PAGE_SIZE)), BigInt(PAGE_SIZE)]
      : undefined,
    chainId,
    query: { enabled: !!walletAddr && !!contractAddr && recipientTotal > 0, refetchInterval: 15_000 },
  })

  if (recipientPage0) {
    recipientPageIds.push(...([...(recipientPage0 as bigint[])].reverse()))
  }

  const createdList = createdIds ? [...(createdIds as bigint[])].reverse() : []

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-12">
      {/* Hero */}
      <div className="text-center space-y-4">
        <h1 className="font-display text-4xl font-bold text-slate-900 dark:text-slate-100 tracking-display text-balance">
          Split incoming USDC<br className="hidden sm:block" /> between your team
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-lg max-w-xl mx-auto text-pretty">
          Every payment is divided the moment it lands — on Arc, where USDC is the native gas token.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Btn
            size="lg"
            onClick={() => { window.location.hash = `#/${netKey}/new` }}
          >
            <Plus size={18} />
            New split
          </Btn>
          <Btn
            variant="secondary"
            size="lg"
            onClick={() => { window.location.hash = `#/${netKey}/me` }}
          >
            <Users size={18} />
            My splits
          </Btn>
        </div>
      </div>

      {/* How it works */}
      <div className="grid sm:grid-cols-3 gap-4">
        {[
          {
            icon: <Plus size={20} />,
            title: 'Create a split',
            body: 'Add recipients with percentage shares. Optionally name a controller for future adjustments.',
          },
          {
            icon: <Zap size={20} />,
            title: 'Receive payments',
            body: 'Anyone pays into the split with a memo. Credits land instantly on each recipient\'s account.',
          },
          {
            icon: <ArrowRight size={20} />,
            title: 'Withdraw',
            body: 'Pull your balance any time, or anyone can push it to you. Shares never commingle.',
          },
        ].map(({ icon, title, body }) => (
          <Card key={title} className="p-5">
            <div className="w-9 h-9 rounded-xl bg-accent-50 dark:bg-accent-950 flex items-center justify-center text-accent-600 mb-3">
              {icon}
            </div>
            <h3 className="font-display font-semibold text-slate-900 dark:text-slate-100 mb-1">{title}</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 text-pretty">{body}</p>
          </Card>
        ))}
      </div>

      {/* Open a split by ID */}
      <Card className="p-5">
        <h2 className="font-display font-semibold text-slate-800 dark:text-slate-200 mb-3">Open split by ID</h2>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            placeholder="e.g. 42"
            value={openId}
            onChange={e => setOpenId(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => e.key === 'Enter' && openId && (window.location.hash = `#/${netKey}/split/${openId}`)}
            className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
          <Btn
            disabled={!openId}
            onClick={() => { window.location.hash = `#/${netKey}/split/${openId}` }}
          >
            Open
          </Btn>
        </div>
      </Card>

      {/* Not deployed */}
      {!contractAddr && (
        <Card className="p-6 text-center text-slate-500">
          Not deployed on this network yet.
        </Card>
      )}

      {/* My splits */}
      {walletAddr && contractAddr && (
        <div className="space-y-6">
          <Card>
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <h2 className="font-display font-semibold text-slate-800 dark:text-slate-200">Splits you created</h2>
            </div>
            {loadingCreated ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : (
              <SplitsTable ids={createdList} netKey={netKey} caption="Splits you created" />
            )}
          </Card>

          <Card>
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <h2 className="font-display font-semibold text-slate-800 dark:text-slate-200">Splits that include you</h2>
            </div>
            {recipientPageIds.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">None yet</p>
            ) : (
              <SplitsTable ids={recipientPageIds} netKey={netKey} caption="Splits that include you" />
            )}
            {pages > 1 && (
              <p className="text-xs text-slate-400 px-5 pb-3">
                Showing most recent {PAGE_SIZE} of {recipientTotal}. Visit My splits for the full list.
              </p>
            )}
          </Card>
        </div>
      )}

      {!walletAddr && contractAddr && (
        <Card className="p-8 text-center space-y-3">
          <p className="text-slate-500">Connect your wallet to see your splits.</p>
        </Card>
      )}

      {/* Rules callout */}
      <Card className="p-5 space-y-2 bg-slate-50 dark:bg-slate-900/50">
        <h3 className="font-display font-semibold text-slate-800 dark:text-slate-200 text-sm">How payments work</h3>
        <ul className="text-sm text-slate-500 dark:text-slate-400 space-y-1 list-disc list-inside text-pretty">
          <li>Every payment is credited at once by the shares — the first recipient gets the rounding remainder (under 1e-16 USDC).</li>
          <li>Recipients withdraw any time; anyone can Release one recipient's credit or Distribute to all.</li>
          <li>Splits are immutable unless created with a controller, whose changes apply only to future payments after the split's fixed delay and expire 7 days after they become ready.</li>
        </ul>
      </Card>
    </div>
  )
}
