/**
 * Chunked eth_getLogs fetcher (used by MePage / PayPage).
 * Arc caps getLogs ranges under 10,000 blocks — we use 9,000-block chunks.
 *
 * Arc's public RPC throttles bursts with -32005, so every chunk is fetched
 * sequentially with retry + exponential backoff and a small inter-chunk delay.
 * The timeline on SplitPage uses scanLogsSequential (./logscan) directly.
 */
import type { PublicClient, AbiEvent, Log } from 'viem'
import { isRateLimitError } from './logscan'

const CHUNK = 9000n
const INTER_CHUNK_DELAY_MS = 55
const MAX_RETRIES = 6
const BASE_BACKOFF_MS = 300

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function getLogsWithRetry(
  client: PublicClient,
  args: Parameters<PublicClient['getLogs']>[0],
): Promise<Log[]> {
  let delay = BASE_BACKOFF_MS
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return (await client.getLogs(args)) as Log[]
    } catch (e) {
      if (!isRateLimitError(e) || attempt === MAX_RETRIES - 1) throw e
      await sleep(delay + Math.floor(Math.random() * 200))
      delay *= 2
    }
  }
  throw new Error('unreachable')
}

export interface LogEntry extends Log {
  args: Record<string, unknown>
  blockNumber: bigint
}

export async function fetchLogsChunked(
  client: PublicClient,
  params: {
    address: `0x${string}`
    event: AbiEvent
    args?: Record<string, unknown>
    fromBlock: bigint
    toBlock: bigint
  }
): Promise<LogEntry[]> {
  const { fromBlock, toBlock, event, address } = params
  const results: LogEntry[] = []
  let from = fromBlock
  while (from <= toBlock) {
    const to = from + CHUNK - 1n < toBlock ? from + CHUNK - 1n : toBlock
    const chunk = await getLogsWithRetry(client, {
      address,
      event,
      ...(params.args ? { args: params.args } : {}),
      fromBlock: from,
      toBlock: to,
    } as Parameters<PublicClient['getLogs']>[0])
    for (const log of chunk) {
      results.push({
        ...log,
        args: ((log as unknown as { args?: Record<string, unknown> }).args) ?? {},
        blockNumber: log.blockNumber ?? 0n,
      })
    }
    from = to + 1n
    if (from <= toBlock) await sleep(INTER_CHUNK_DELAY_MS)
  }
  return results
}

export async function getCurrentBlock(client: PublicClient): Promise<bigint> {
  return client.getBlockNumber()
}
