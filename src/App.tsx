import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ArrowLeft } from 'lucide-react'

function CordonLogo({ className }: { className?: string }) {
  return (
    <img
      src="/cordon-logo.png"
      alt="Cordon"
      className={className ?? 'w-24 h-24 md:w-28 md:h-28 object-contain'}
    />
  )
}

type Receipt = {
  type?: string
  timestamp?: string
  position?: string
  healthFactorBefore?: string | number | null
  healthFactorAfter?: string | number | null
  decision?: string
  action?: string
  asset?: string
  amount?: string | number
  refused?: boolean
  txHash?: string | null
  status?: string
  error?: string | null
  executionId?: string
}

const PAGE_SIZE = 25

// Stand-downs appear with either field spelling across receipt eras:
// { action: 'stand-down' } or { decision: 'stand-down' | 'stand_down' }.
const isStandDown = (x: Receipt) =>
  x.action === 'stand-down' ||
  x.action === 'stand_down' ||
  x.decision === 'stand-down' ||
  x.decision === 'stand_down'

function shortHash(h: string, n = 10) {
  if (!h) return '—'
  return `${h.slice(0, n)}…${h.slice(-4)}`
}

function AuditPage() {
  const [receipts, setReceipts] = useState<Receipt[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<'all' | 'executed' | 'refused' | 'stand-down'>('all')

  useEffect(() => {
    fetch('/receipts.json')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        const arr = Array.isArray(data) ? data : data.receipts ?? []
        setReceipts(arr as Receipt[])
      })
      .catch((e) => setError(String(e.message ?? e)))
  }, [])

  const stats = useMemo(() => {
    if (!receipts) return null
    const executed = receipts.filter(
      (x) => x.status === 'completed' && !x.refused && x.txHash
    ).length
    const refused = receipts.filter((x) => x.refused === true).length
    const standDown = receipts.filter(isStandDown).length
    return { total: receipts.length, executed, refused, standDown }
  }, [receipts])

  const filtered = useMemo(() => {
    if (!receipts) return []
    switch (filter) {
      case 'executed':
        return receipts.filter(
          (x) => x.status === 'completed' && !x.refused && x.txHash
        )
      case 'refused':
        return receipts.filter((x) => x.refused === true)
      case 'stand-down':
        return receipts.filter(isStandDown)
      default:
        return receipts
    }
  }, [receipts, filter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount)
  const rows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const filterBtn = (key: typeof filter, label: string, count: number) => (
    <button
      onClick={() => {
        setFilter(key)
        setPage(1)
      }}
      className={`px-4 py-2 text-xs font-medium transition-colors btn-cut ${
        filter === key
          ? 'bg-white text-black'
          : 'bg-white/5 text-white/70 hover:bg-white/15'
      }`}
    >
      {label} · {count}
    </button>
  )

  return (
    <div className="min-h-screen w-full bg-black p-3 md:p-4 font-inter">
      <div className="w-full min-h-screen rounded-2xl flex flex-col overflow-hidden relative bg-[#0a0a0f] border border-white/10">
        {/* Backdrop video — same asset as the landing page, dimmed for readability */}
        <video
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260717_120352_eb988725-1351-43b3-8095-16e4a1005e3d.mp4"
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover opacity-[0.14] anim-fade"
          style={{ animationDelay: '0.1s' }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/75 to-black/90" />

        <div className="relative z-10 flex-1 flex flex-col px-6 md:px-10 py-8">
          {/* Header — mirrors the landing navbar: logo, hero-styled title, cut buttons */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4 anim-stagger" style={{ animationDelay: '0.1s' }}>
              <a
                href="#/"
                aria-label="Back to home"
                className="w-10 h-10 shrink-0 bg-white flex items-center justify-center text-black hover:bg-white/90 transition-colors btn-cut-sm"
              >
                <ArrowLeft className="w-4 h-4" />
              </a>
              <CordonLogo className="hidden sm:block w-12 h-12 md:w-14 md:h-14 object-contain" />
              <div>
                <h1
                  className="text-white text-2xl md:text-4xl font-normal leading-[1.1] tracking-[-0.04em]"
                  style={{ textShadow: '0 2px 12px rgba(0,0,0,0.25)' }}
                >
                  Live audit stream
                </h1>
                <p className="text-white/50 text-xs mt-1">
                  Every decision Cordon made, straight from{' '}
                  <code className="text-white/70">receipts.json</code>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 anim-stagger" style={{ animationDelay: '0.2s' }}>
              <a
                href="https://github.com/thesithunyein/cordon"
                target="_blank"
                rel="noreferrer"
                className="hidden md:block px-5 py-2.5 text-white text-sm hover:bg-white/10 btn-cut-border transition-colors"
              >
                <span>GitHub</span>
              </a>
              <a
                href="/receipts.json"
                target="_blank"
                rel="noreferrer"
                className="px-5 py-2.5 bg-white text-black text-sm hover:bg-white/90 btn-cut transition-colors"
              >
                raw JSON
              </a>
            </div>
          </div>

          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 anim-stagger" style={{ animationDelay: '0.3s' }}>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-white/50 text-xs">Total receipts</div>
                <div className="text-white text-3xl font-medium mt-1">
                  {stats.total}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-white/50 text-xs">Executed on-chain</div>
                <div className="text-emerald-400 text-3xl font-medium mt-1">
                  {stats.executed}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-white/50 text-xs">Simulation refusals</div>
                <div className="text-amber-400 text-3xl font-medium mt-1">
                  {stats.refused}
                </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="text-white/50 text-xs">Stand-downs (healthy)</div>
                <div className="text-sky-400 text-3xl font-medium mt-1">
                  {stats.standDown}
                </div>
              </div>
            </div>
          )}

          {/* Filters */}
          {stats && (
            <div className="flex flex-wrap gap-2 mb-4 anim-stagger" style={{ animationDelay: '0.4s' }}>
              {filterBtn('all', 'All', stats.total)}
              {filterBtn('executed', 'Executed', stats.executed)}
              {filterBtn('refused', 'Refused', stats.refused)}
              {filterBtn('stand-down', 'Stand-down', stats.standDown)}
            </div>
          )}

          {/* Table */}
          {error ? (
            <div className="text-red-400 text-sm">Failed to load receipts: {error}</div>
          ) : !receipts ? (
            <div className="text-white/50 text-sm anim-fade" style={{ animationDelay: '0.3s' }}>Loading receipts…</div>
          ) : (
            <div className="flex-1 overflow-auto rounded-xl border border-white/10 bg-white/[0.02] anim-stagger" style={{ animationDelay: '0.5s' }}>
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-[#0d0d14] text-white/50 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">#</th>
                    <th className="px-4 py-3">Decision</th>
                    <th className="px-4 py-3">Tx hash</th>
                    <th className="px-4 py-3">HF before → after</th>
                    <th className="px-4 py-3">Asset / amount</th>
                    <th className="px-4 py-3">Execution ID</th>
                    <th className="px-4 py-3">Time (UTC)</th>
                  </tr>
                </thead>
                <tbody className="text-white/80">
                  {rows.map((x, i) => {
                    const idx = (safePage - 1) * PAGE_SIZE + i
                    const hf = (v?: string | number | null) => {
                      if (v == null) return '—'
                      const n = Number(v)
                      if (n >= 1e60) return '∞' // no-debt position → max uint256 HF
                      return n / 1e18 >= 1 ? (n / 1e18).toFixed(2) : String(n)
                    }
                    return (
                      <tr
                        key={idx}
                        className="border-t border-white/5 hover:bg-white/[0.03]"
                      >
                        <td className="px-4 py-2.5 text-white/40">{idx + 1}</td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`text-xs px-2 py-0.5 rounded ${
                              x.refused
                                ? 'bg-amber-400/10 text-amber-300'
                                : isStandDown(x)
                                ? 'bg-sky-400/10 text-sky-300'
                                : 'bg-emerald-400/10 text-emerald-300'
                            }`}
                          >
                            {x.refused ? 'REFUSED' : x.action ?? x.decision ?? x.status ?? '—'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          {x.txHash ? (
                            <a
                              href={`https://sepolia.etherscan.io/tx/${x.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-white/80 hover:text-white underline decoration-white/20 font-mono text-xs"
                            >
                              {shortHash(x.txHash)}
                            </a>
                          ) : (
                            <span className="text-white/30 text-xs">—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs">
                          {hf(x.healthFactorBefore)} → {hf(x.healthFactorAfter)}
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {x.asset ?? '—'} {x.amount != null ? x.amount : ''}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-xs text-white/50">
                          {x.executionId ? shortHash(x.executionId, 8) : '—'}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-white/40">
                          {x.timestamp ? x.timestamp.replace('T', ' ').slice(0, 16) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {filtered.length > 0 && (
            <div className="flex items-center justify-between mt-4 anim-stagger" style={{ animationDelay: '0.65s' }}>
              <div className="text-white/40 text-xs">
                {filtered.length} receipts · page {safePage} / {pageCount}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="px-4 py-2 text-xs bg-white/5 text-white/70 hover:bg-white/15 disabled:opacity-30 btn-cut transition-colors"
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={safePage >= pageCount}
                  className="px-4 py-2 text-xs bg-white/5 text-white/70 hover:bg-white/15 disabled:opacity-30 btn-cut transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function HeroPage() {
  return (
    <div className="min-h-screen w-full bg-black p-3 md:p-4 font-inter">
      <div className="w-full min-h-screen rounded-2xl flex flex-col overflow-hidden relative bg-black">
        {/* Background Video */}
        <video
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260717_120352_eb988725-1351-43b3-8095-16e4a1005e3d.mp4"
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover anim-fade"
          style={{ animationDelay: '0.2s' }}
        />

        {/* Navbar */}
        <nav className="relative z-10 flex items-center justify-between px-6 md:px-10 pt-4 md:pt-5">
          {/* Logo */}
          <div className="anim-stagger" style={{ animationDelay: '0.1s' }}>
            <CordonLogo />
            <span className="text-white text-sm md:text-base tracking-normal mt-2 block font-light">
              CORDON
            </span>
          </div>

          {/* Nav Buttons */}
          <div
            className="flex items-center gap-3 anim-stagger"
            style={{ animationDelay: '0.2s' }}
          >
            <a
              href="#/audit"
              className="hidden md:block px-5 py-2.5 text-white text-sm hover:bg-white/10 btn-cut-border transition-colors"
            >
              <span>Live proof</span>
            </a>
            <a
              href="https://github.com/thesithunyein/cordon"
              target="_blank"
              rel="noreferrer"
              className="hidden md:block px-5 py-2.5 bg-white text-black text-sm hover:bg-white/90 btn-cut transition-colors"
            >
              GitHub
            </a>
          </div>
        </nav>

        {/* Main Content */}
        <div className="relative z-10 flex-1 flex flex-col justify-between px-6 md:px-10 pb-6 md:pb-8">
          {/* Top Section */}
          <div className="flex-1 flex items-center relative">
            {/* Left Column (hidden below lg) */}
            <div
              className="hidden lg:flex flex-col gap-6 absolute left-0 top-[6%] anim-stagger"
              style={{ animationDelay: '0.4s' }}
            >
              <p className="text-white/80 text-base leading-relaxed max-w-[240px]">
                Health factor drops.<br />
                Cordon simulates,<br />
                executes, verifies.
              </p>
              <div className="flex flex-col gap-2 mt-4">
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded-full border border-white/40" />
                  <div className="w-4 h-4 rounded-full border border-white/40" />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-white/70 text-xs">
                    Live on<br />Sepolia
                  </span>
                  <span className="text-white/50 text-xs">01</span>
                </div>
              </div>
            </div>

            {/* Center Heading */}
            <div
              className="w-full text-center anim-stagger"
              style={{ animationDelay: '0.5s' }}
            >
              <h1
                className="text-white text-3xl sm:text-4xl md:text-5xl lg:text-5xl xl:text-6xl font-normal leading-[1.1] tracking-[-0.04em]"
                style={{ textShadow: '0 2px 12px rgba(0,0,0,0.25)' }}
              >
                Your Aave position<br />
                defended automatically<br />
                by Cordon
              </h1>
            </div>
          </div>

          {/* Bottom Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center mt-4">
            {/* Col 1 */}
            <div
              className="flex items-center justify-center md:justify-end anim-stagger"
              style={{ animationDelay: '0.7s' }}
            >
              <p className="text-white text-sm leading-relaxed max-w-[280px] text-center md:text-left md:ml-auto">
                Cordon monitors your Aave V3 position on Sepolia, and when the
                health factor crosses your threshold it executes the protective
                transaction through KeeperHub — simulated first, audited always.
              </p>
            </div>

            {/* Col 2 */}
            <div
              className="flex flex-col items-center gap-6 md:gap-10 anim-stagger"
              style={{ animationDelay: '0.85s' }}
            >
              <span className="text-white text-2xl md:text-3xl font-medium">
                Powered by KeeperHub
              </span>
              <a
                href="https://github.com/thesithunyein/cordon#architecture"
                target="_blank"
                rel="noreferrer"
                className="w-full max-w-[280px] py-3.5 bg-white flex items-center justify-center gap-2 text-black hover:bg-white/90 transition-colors group btn-cut"
              >
                <span className="text-sm font-medium">Read the integration</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </a>
            </div>

            {/* Col 3 — spacer keeps the CTA optically centered */}
            <div className="hidden md:block" />
          </div>

          {/* Live proof strip */}
          <div
            className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-4 md:mt-5 anim-stagger"
            style={{ animationDelay: '1.15s' }}
          >
            <span className="text-white/60 text-xs tracking-wide">
              1,082 on-chain transactions · 91 refusals · 147 stand-downs
            </span>
            <a
              href="#/audit"
              className="text-white/60 text-xs underline decoration-white/20 hover:text-white transition-colors"
            >
              live audit stream
            </a>
            <a
              href="https://github.com/thesithunyein/cordon/blob/master/harness/receipts/receipts.json"
              target="_blank"
              rel="noreferrer"
              className="text-white/60 text-xs underline decoration-white/20 hover:text-white transition-colors"
            >
              receipts.json
            </a>
            <a
              href="https://github.com/thesithunyein/cordon/blob/master/harness/docs/EVIDENCE.md"
              target="_blank"
              rel="noreferrer"
              className="text-white/60 text-xs underline decoration-white/20 hover:text-white transition-colors"
            >
              evidence
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [route, setRoute] = useState(window.location.hash)

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (route.startsWith('#/audit')) return <AuditPage />
  return <HeroPage />
}