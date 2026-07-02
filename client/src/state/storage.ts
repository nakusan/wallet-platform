export type AppSettings = {
  apiBase: string
  apiKey: string
  token: string
  tokenExpiresAt: number | null
}

const KEY = 'wallet-platform:test-client:v1'

export function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultSettings()
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      apiBase: typeof parsed.apiBase === 'string' ? parsed.apiBase : '/v1',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      token: typeof parsed.token === 'string' ? parsed.token : '',
      tokenExpiresAt: typeof parsed.tokenExpiresAt === 'number' ? parsed.tokenExpiresAt : null,
    }
  } catch {
    return defaultSettings()
  }
}

export function saveAppSettings(s: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // ignore
  }
}

export function defaultSettings(): AppSettings {
  return {
    apiBase: '/v1',
    apiKey: '',
    token: '',
    tokenExpiresAt: null,
  }
}

