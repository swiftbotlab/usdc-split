/**
 * Chunked eth_getLogs fetcher.
 * Arc caps getLogs ranges under 10,000 blocks — we use 9,000-block chunks.
 */
import type { PublicClient, AbiEvent, Log } from 'viem'

const CHUNK = 9000n

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
    const chunk = await client.getLogs({
      address,
      event: event,
      fromBlock: from,
      toBlock: to,
    })
    for (const log of chunk) {
      results.push({
        ...log,
        args: (log.args as Record<string, unknown>) ?? {},
        blockNumber: log.blockNumber ?? 0n,
      })
    }
    from = to + 1n
  }
  return results
}

export async function getCurrentBlock(client: PublicClient): Promise<bigint> {
  return client.getBlockNumber()
}
