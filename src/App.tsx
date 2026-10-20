/**
 * USDC Split — App Router
 * Hash routing: #/<net>/split/<id>, #/<net>/pay/<id>, #/<net>/new, #/<net>/me
 */
import { useState, useEffect } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Header } from './components/Header'
import { TestnetBanner } from './components/TestnetBanner'
import { Home } from './pages/Home'
import { NewSplit } from './pages/NewSplit'
import { SplitPage } from './pages/SplitPage'
import { PayPage } from './pages/PayPage'
import { MePage } from './pages/MePage'
import { useNetwork } from './hooks/useNetwork'

// ─── Frame guard ─────────────────────────────────────────────────────────────
function isFrameBlocked(): boolean {
  try {
    if (window.self === window.top) return false
    const origins = window.location.ancestorOrigins
    if (!origins) return true
    for (let i = 0; i < origins.length; i++) {
      if (!origins[i].startsWith('https://studio.arc.io')) return true
    }
    return false
  } catch {
    return true
  }
}

function useFrameGuard(): boolean {
  const [blocked] = useState(() => isFrameBlocked())
  return blocked
}

// ─── Router ───────────────────────────────────────────────────────────────────
function parseRoute(hash: string): {
  netKey: 'testnet' | 'mainnet'
  page: 'home' | 'new' | 'split' | 'pay' | 'me'
  id?: string
  params: URLSearchParams
} {
  // #/<net>/<page>[/<id>][?...]
  const [pathPart, queryPart = ''] = hash.replace(/^#/, '').split('?')
  const segments = pathPart.split('/').filter(Boolean)
  const params = new URLSearchParams(queryPart)

  const netKey: 'testnet' | 'mainnet' =
    segments[0] === 'testnet' || segments[0] === 'mainnet' ? segments[0] : 'mainnet'
  const pageSeg = segments[1] ?? ''
  const idSeg = segments[2]

  if (pageSeg === 'new') return { netKey, page: 'new', params }
  if (pageSeg === 'me') return { netKey, page: 'me', params }
  if (pageSeg === 'split' && idSeg) return { netKey, page: 'split', id: idSeg, params }
  if (pageSeg === 'pay' && idSeg) return { netKey, page: 'pay', id: idSeg, params }
  return { netKey, page: 'home', params }
}

function AppContent() {
  const { netKey } = useNetwork()
  const [hash, setHash] = useState(() => window.location.hash || `#/${netKey}/`)

  useEffect(() => {
    function onHashChange() {
      setHash(window.location.hash || `#/${netKey}/`)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [netKey])

  // Redirect bare # to /#/<defaultNet>/
  useEffect(() => {
    if (!window.location.hash || window.location.hash === '#') {
      window.location.hash = `#/${netKey}/`
    }
  }, [netKey])

  const route = parseRoute(hash)
  const isTestnet = route.netKey === 'testnet'

  let content: React.ReactNode
  switch (route.page) {
    case 'new':
      content = <NewSplit />
      break
    case 'split':
      content = <SplitPage id={route.id!} />
      break
    case 'pay':
      content = (
        <PayPage
          id={route.id!}
          initAmount={route.params.get('amount') ?? undefined}
          initMemo={route.params.get('memo') ?? undefined}
          initVersion={route.params.get('v') ?? undefined}
        />
      )
      break
    case 'me':
      content = <MePage />
      break
    default:
      content = <Home />
  }

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950 font-sans">
      {isTestnet && <TestnetBanner />}
      <Header />
      <main>
        <ErrorBoundary key={hash}>
          {content}
        </ErrorBoundary>
      </main>
      {/* Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 mt-20">
        <div className="max-w-5xl mx-auto px-4 py-6 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-3">
            <a
              href={
                isTestnet
                  ? 'https://explorer.testnet.arc.io/address/0xcea442379f266e888277e5f29bc721ad3bb3f9a2'
                  : 'https://explorer.arc.io/address/0x1ddb12d50b11a97106821896d0e70852fa8902e1'
              }
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-accent-600 transition-colors"
            >
              Contract on explorer
            </a>
            <span>·</span>
            <span>{isTestnet ? 'Arc Testnet' : 'Arc Mainnet'}</span>
          </div>
          <span>Swift Bot Labs</span>
        </div>
      </footer>
    </div>
  )
}

export default function App() {
  const frameBlocked = useFrameGuard()

  if (frameBlocked) {
    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          color: '#0f172a',
          background: '#f8fafc',
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <div>
          <p style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.75rem' }}>
            Open USDC Split in its own tab
          </p>
          <a
            href={window.location.href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              padding: '0.625rem 1.25rem',
              background: '#0d9488',
              color: '#fff',
              borderRadius: '0.75rem',
              textDecoration: 'none',
              fontSize: '0.875rem',
              fontWeight: 500,
            }}
          >
            Open in new tab
          </a>
        </div>
      </div>
    )
  }

  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  )
}
