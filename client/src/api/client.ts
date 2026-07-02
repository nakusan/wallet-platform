export type ApiResult<T> =
  | { ok: true; status: number; data: T; headers: Headers; durationMs: number; url: string }
  | { ok: false; status: number | null; errorKind: 'http_error' | 'network_error' | 'parse_error'; error: unknown; durationMs: number; url: string }

export type ApiFetchOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  token?: string
  jsonBody?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
}

export function joinUrl(base: string, path: string): string {
  const b = base.endsWith('/') ? base.slice(0, -1) : base
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}

export function withQuery(url: string, query: Record<string, string | number | boolean | null | undefined>): string {
  const u = new URL(url, window.location.origin)
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue
    u.searchParams.set(k, String(v))
  }
  return u.pathname + u.search
}

export async function apiFetch<T>(url: string, opts: ApiFetchOptions = {}): Promise<ApiResult<T>> {
  const start = performance.now()
  const method = opts.method ?? 'GET'

  const headers: Record<string, string> = {
    ...(opts.headers ?? {}),
  }
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`
  if (opts.jsonBody !== undefined) headers['Content-Type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers,
      body: opts.jsonBody !== undefined ? JSON.stringify(opts.jsonBody) : undefined,
      signal: opts.signal,
    })
  } catch (err) {
    const durationMs = Math.round(performance.now() - start)
    return { ok: false, status: null, errorKind: 'network_error', error: err, durationMs, url }
  }

  const durationMs = Math.round(performance.now() - start)
  const status = res.status

  let data: unknown = null
  try {
    const text = await res.text()
    data = text ? JSON.parse(text) : null
  } catch (err) {
    return { ok: false, status, errorKind: 'parse_error', error: err, durationMs, url }
  }

  if (!res.ok) {
    return { ok: false, status, errorKind: 'http_error', error: data, durationMs, url }
  }

  return { ok: true, status, data: data as T, headers: res.headers, durationMs, url }
}

