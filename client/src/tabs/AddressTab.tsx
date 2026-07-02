import { useMemo, useState } from 'react'
import type { AppSettings } from '../state/storage'
import type { RequestLogItem } from '../components/RequestInspector'
import { apiFetch, joinUrl, withQuery } from '../api/client'
import { CopyButton } from '../components/CopyButton'

function newId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function parseChainIds(raw: string): number[] {
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
}

function isAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr)
}

function shortHex(s: string, left = 6, right = 4) {
  if (!s) return ''
  if (s.length <= left + right + 2) return s
  return `${s.slice(0, left)}…${s.slice(-right)}`
}

type BalancesResponse = unknown
type PortfolioResponse = unknown
type NftsResponse = { data?: unknown[]; nextCursor?: string | null; hasMore?: boolean } & Record<string, unknown>
type ActivityResponse = { data?: unknown[]; nextCursor?: string | null; hasMore?: boolean; partial?: boolean } & Record<string, unknown>

export function AddressTab(props: { settings: AppSettings; pushLog: (item: RequestLogItem) => void }) {
  const [address, setAddress] = useState('')
  const [chainIdsRaw, setChainIdsRaw] = useState('')
  const [activityLimit, setActivityLimit] = useState(20)
  const [nftLimit, setNftLimit] = useState(50)

  const [balances, setBalances] = useState<BalancesResponse | null>(null)
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null)
  const [activity, setActivity] = useState<ActivityResponse | null>(null)
  const [nfts, setNfts] = useState<NftsResponse | null>(null)

  const [activityCursor, setActivityCursor] = useState<string | null>(null)
  const [nftsCursor, setNftsCursor] = useState<string | null>(null)

  const chainIds = useMemo(() => parseChainIds(chainIdsRaw), [chainIdsRaw])
  const validAddr = isAddress(address.trim())
  const hasToken = Boolean(props.settings.token)

  const commonDisabled = !hasToken || !validAddr

  async function run<T>(name: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string) {
    const result = await apiFetch<T>(url, { method, token: props.settings.token })
    props.pushLog({
      id: newId(),
      name,
      method,
      url,
      durationMs: result.durationMs,
      status: result.ok ? result.status : result.status,
      ok: result.ok,
      response: result.ok ? (result as any).data : (result as any).error,
    })
    return result
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div className="panel-title">地址查询</div>
      </div>

      <div className="form-grid">
        <label className="field">
          <div className="field-label">地址</div>
          <input
            className="input mono"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x..."
          />
          {!validAddr && address.trim() && <div className="field-hint err">地址格式不合法</div>}
        </label>

        <label className="field">
          <div className="field-label">chainIds（可空）</div>
          <input
            className="input mono"
            value={chainIdsRaw}
            onChange={(e) => setChainIdsRaw(e.target.value)}
            placeholder="例如：1,137"
          />
        </label>

        <label className="field">
          <div className="field-label">Activity limit</div>
          <input
            className="input mono"
            value={String(activityLimit)}
            onChange={(e) => setActivityLimit(Number(e.target.value || 20))}
          />
        </label>

        <label className="field">
          <div className="field-label">NFT limit</div>
          <input
            className="input mono"
            value={String(nftLimit)}
            onChange={(e) => setNftLimit(Number(e.target.value || 50))}
          />
        </label>
      </div>

      {!hasToken && (
        <div className="callout warn">未设置 Token。请先在“设置”页获取 token。</div>
      )}

      <div className="row gap wrap">
        <button
          type="button"
          className="btn btn-primary"
          disabled={commonDisabled}
          onClick={async () => {
            const base = joinUrl(props.settings.apiBase, `/address/${address.trim()}/balances`)
            const url = withQuery(base, {
              chainIds: chainIds.length ? chainIds.join(',') : '',
              withPricing: 1,
            })
            const r = await run<BalancesResponse>('Get Balances', 'GET', url)
            if (r.ok) setBalances(r.data)
          }}
        >
          查 Balances
        </button>

        <button
          type="button"
          className="btn btn-primary"
          disabled={commonDisabled}
          onClick={async () => {
            const base = joinUrl(props.settings.apiBase, `/address/${address.trim()}/portfolio`)
            const url = withQuery(base, { chainIds: chainIds.length ? chainIds.join(',') : '' })
            const r = await run<PortfolioResponse>('Get Portfolio', 'GET', url)
            if (r.ok) setPortfolio(r.data)
          }}
        >
          查 Portfolio
        </button>

        <button
          type="button"
          className="btn btn-primary"
          disabled={commonDisabled}
          onClick={async () => {
            const base = joinUrl(props.settings.apiBase, `/address/${address.trim()}/nfts`)
            const url = withQuery(base, {
              chainIds: chainIds.length ? chainIds.join(',') : '',
              limit: nftLimit,
              cursor: '',
            })
            const r = await run<NftsResponse>('Get NFTs', 'GET', url)
            if (r.ok) {
              setNfts(r.data)
              setNftsCursor(r.data.nextCursor ?? null)
            }
          }}
        >
          查 NFTs
        </button>

        <button
          type="button"
          className="btn btn-primary"
          disabled={commonDisabled}
          onClick={async () => {
            const base = joinUrl(props.settings.apiBase, `/address/${address.trim()}/activity`)
            const url = withQuery(base, {
              chainIds: chainIds.length ? chainIds.join(',') : '',
              limit: activityLimit,
              cursor: '',
            })
            const r = await run<ActivityResponse>('Get Activity', 'GET', url)
            if (r.ok) {
              setActivity(r.data)
              setActivityCursor(r.data.nextCursor ?? null)
            }
          }}
        >
          查 Activity
        </button>

        <button
          type="button"
          className="btn"
          disabled={commonDisabled || !activityCursor}
          onClick={async () => {
            const base = joinUrl(props.settings.apiBase, `/address/${address.trim()}/activity`)
            const url = withQuery(base, {
              chainIds: chainIds.length ? chainIds.join(',') : '',
              limit: activityLimit,
              cursor: activityCursor ?? '',
            })
            const r = await run<ActivityResponse>('Get Activity (more)', 'GET', url)
            if (r.ok) {
              const prev = activity?.data ?? []
              const next = (r.data.data ?? []) as unknown[]
              setActivity({ ...r.data, data: [...prev, ...next] })
              setActivityCursor(r.data.nextCursor ?? null)
            }
          }}
        >
          加载更多 Activity
        </button>

        <button
          type="button"
          className="btn"
          disabled={commonDisabled || !nftsCursor}
          onClick={async () => {
            const base = joinUrl(props.settings.apiBase, `/address/${address.trim()}/nfts`)
            const url = withQuery(base, {
              chainIds: chainIds.length ? chainIds.join(',') : '',
              limit: nftLimit,
              cursor: nftsCursor ?? '',
            })
            const r = await run<NftsResponse>('Get NFTs (more)', 'GET', url)
            if (r.ok) {
              const prev = nfts?.data ?? []
              const next = (r.data.data ?? []) as unknown[]
              setNfts({ ...r.data, data: [...prev, ...next] })
              setNftsCursor(r.data.nextCursor ?? null)
            }
          }}
        >
          加载更多 NFTs
        </button>

        {activityCursor && (
          <div className="row gap">
            <span className="muted">activity nextCursor:</span>
            <span className="mono">{shortHex(activityCursor, 16, 8)}</span>
            <CopyButton value={activityCursor} label="复制cursor" />
          </div>
        )}
      </div>

      <div className="grid-2">
        <section className="subpanel">
          <div className="subpanel-title">Balances（结构化预览）</div>
          <StructuredBalances value={balances} />
        </section>

        <section className="subpanel">
          <div className="subpanel-title">Portfolio（结构化预览）</div>
          <StructuredPortfolio value={portfolio} />
        </section>

        <section className="subpanel">
          <div className="subpanel-title">Activity（结构化预览）</div>
          <StructuredActivity value={activity} />
        </section>

        <section className="subpanel">
          <div className="subpanel-title">NFTs（结构化预览）</div>
          <StructuredNfts value={nfts} />
        </section>
      </div>
    </section>
  )
}

function StructuredBalances(props: { value: unknown }) {
  // 兼容未知返回形状：尽量探测常见字段并展示；同时保留 raw
  const v = props.value as any
  if (!v) return <div className="muted">暂无数据</div>

  const chains = Array.isArray(v?.chains) ? v.chains : (Array.isArray(v) ? v : null)
  if (chains && Array.isArray(chains)) {
    return (
      <>
        <div className="muted">检测到多链数组/聚合结构（chains/array）。</div>
        <pre className="pre">{JSON.stringify(v, null, 2)}</pre>
      </>
    )
  }

  const chainId = v?.chainId
  const native = v?.native
  const tokens = Array.isArray(v?.tokens) ? v.tokens : []
  return (
    <>
      <div className="row gap wrap">
        <span className="pill">chainId: <span className="mono">{String(chainId ?? '-')}</span></span>
        <span className="pill">tokens: <span className="mono">{String(tokens.length)}</span></span>
      </div>
      {native && (
        <div className="kv">
          <div className="kv-k">Native</div>
          <div className="kv-v mono">{native.symbol} {native.balance}</div>
        </div>
      )}
      {tokens.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>symbol</th>
              <th className="right">balance</th>
              <th>decimals</th>
              <th>contract</th>
            </tr>
          </thead>
          <tbody>
            {tokens.slice(0, 25).map((t: any) => (
              <tr key={t.contractAddress}>
                <td className="mono">{t.symbol}</td>
                <td className="mono right">{t.balance}</td>
                <td className="mono">{t.decimals}</td>
                <td className="mono">
                  {shortHex(t.contractAddress, 10, 6)}{' '}
                  <CopyButton value={t.contractAddress} label="复制" className="btn btn-small" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details>
        <summary className="link">Raw JSON</summary>
        <pre className="pre">{JSON.stringify(v, null, 2)}</pre>
      </details>
    </>
  )
}

function StructuredPortfolio(props: { value: unknown }) {
  const v = props.value as any
  if (!v) return <div className="muted">暂无数据</div>
  const chains = Array.isArray(v?.chains) ? v.chains : []

  return (
    <>
      <div className="row gap wrap">
        <span className="pill">totalValueUsd: <span className="mono">{String(v.totalValueUsd ?? '-')}</span></span>
        <span className="pill">partial: <span className="mono">{String(Boolean(v.partial))}</span></span>
        <span className="pill">chains: <span className="mono">{String(chains.length)}</span></span>
      </div>
      {chains.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>chainId</th>
              <th>status</th>
              <th className="right">chainTotalUsd</th>
              <th>error</th>
            </tr>
          </thead>
          <tbody>
            {chains.map((c: any) => (
              <tr key={String(c.chainId)}>
                <td className="mono">{c.chainId}</td>
                <td className={c.status === 'ok' ? 'ok' : 'err'}>{c.status}</td>
                <td className="mono right">{c.data?.chainTotalUsd ?? '-'}</td>
                <td className="mono">{c.error ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details>
        <summary className="link">Raw JSON</summary>
        <pre className="pre">{JSON.stringify(v, null, 2)}</pre>
      </details>
    </>
  )
}

function StructuredActivity(props: { value: ActivityResponse | null }) {
  const v = props.value as any
  if (!v) return <div className="muted">暂无数据</div>
  const data = Array.isArray(v.data) ? v.data : []
  return (
    <>
      <div className="row gap wrap">
        <span className="pill">count: <span className="mono">{String(data.length)}</span></span>
        <span className="pill">hasMore: <span className="mono">{String(Boolean(v.hasMore))}</span></span>
        <span className="pill">partial: <span className="mono">{String(Boolean(v.partial))}</span></span>
      </div>
      {data.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>time</th>
              <th>chain</th>
              <th>type</th>
              <th>status</th>
              <th>tx</th>
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 25).map((a: any) => (
              <tr key={a.id}>
                <td className="mono">{String(a.timestamp ?? '').slice(0, 19).replace('T', ' ')}</td>
                <td className="mono">{a.chainId}</td>
                <td className="mono">{a.type}</td>
                <td className={a.status === 'success' ? 'ok' : 'err'}>{a.status}</td>
                <td className="mono">
                  {shortHex(a.txHash, 10, 6)}{' '}
                  <CopyButton value={a.txHash} label="复制" className="btn btn-small" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details>
        <summary className="link">Raw JSON</summary>
        <pre className="pre">{JSON.stringify(v, null, 2)}</pre>
      </details>
    </>
  )
}

function StructuredNfts(props: { value: NftsResponse | null }) {
  const v = props.value as any
  if (!v) return <div className="muted">暂无数据</div>
  const data = Array.isArray(v.data) ? v.data : []
  return (
    <>
      <div className="row gap wrap">
        <span className="pill">count: <span className="mono">{String(data.length)}</span></span>
        <span className="pill">hasMore: <span className="mono">{String(Boolean(v.hasMore))}</span></span>
        <span className="pill">nextCursor: <span className="mono">{v.nextCursor ? shortHex(String(v.nextCursor), 14, 6) : '-'}</span></span>
      </div>
      {data.length > 0 && (
        <div className="nft-grid">
          {data.slice(0, 18).map((n: any, idx: number) => (
            <div className="nft-card" key={`${n.contractAddress ?? 'c'}:${n.tokenId ?? idx}`}>
              <div className="nft-img">
                {n.imageUrl ? <img src={n.imageUrl} alt="" /> : <div className="muted">no image</div>}
              </div>
              <div className="nft-meta">
                <div className="mono">{n.name ?? shortHex(n.contractAddress ?? '', 10, 6)}</div>
                <div className="muted mono">#{n.tokenId}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <details>
        <summary className="link">Raw JSON</summary>
        <pre className="pre">{JSON.stringify(v, null, 2)}</pre>
      </details>
    </>
  )
}

