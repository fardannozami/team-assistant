// Naya talks to daily's API (apps/api, /naya/*) with daily's own sign-in token, kept per browser.
// Pages ask for '/api/<x>' (as in upstream Ruang); that maps to `${API_BASE}/naya/<x>`.

export const API_BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '')
/** The dashboard (daily.digdaya.co), for links back. */
export const DAILY_URL = (import.meta.env.VITE_DAILY_URL ?? 'http://localhost:3000').replace(/\/+$/, '')

/** Fired when the API says the session is over, so the app shows the sign-in screen again. */
export const LOCKED_EVENT = 'naya:locked'
const TOKEN_KEY = 'naya_token'

export function getToken(): string | null {
  try { return window.localStorage.getItem(TOKEN_KEY) } catch { return null }
}
export function setToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token)
    else window.localStorage.removeItem(TOKEN_KEY)
  } catch { /* private mode: signed in for this tab only */ }
}

export function apiUrl(path: string): string {
  return path.startsWith('/api/') ? `${API_BASE}/naya/${path.slice(5)}` : `${API_BASE}${path}`
}

/** fetch with the sign-in token; a 401 signs this browser out. */
export const apiFetch: typeof fetch = async (input, init = {}) => {
  const path = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const headers = new Headers(init.headers)
  const token = getToken()
  if (token) headers.set('authorization', `Bearer ${token}`)
  const response = await fetch(apiUrl(path), { ...init, headers })
  if (response.status === 401 && token) {
    setToken(null)
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(LOCKED_EVENT))
  }
  return response
}

export const googleLoginUrl = () => `${API_BASE}/auth/google?app=naya`

/**
 * Reads what daily put in the address after sign-in: `#token=` (Google), `#login=` (a one-time
 * link from "Buka Naya" or WhatsApp, swapped here for a token) or `#auth_error=`.
 */
/** A page of this app a sign-in link may open (same rule as the API's NEXT_PATH). */
const NEXT_PAGE = /^\/(?!\/)[A-Za-z0-9/_.%-]{0,200}$/

export async function consumeAuthRedirect(): Promise<string | undefined> {
  if (typeof window === 'undefined') return undefined
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const token = params.get('token')
  const code = params.get('login')
  const error = params.get('auth_error') ?? undefined
  if (!token && !code && !error) return undefined
  // A sign-in link may name the page to open, e.g. the card a WhatsApp handover is about.
  const next = params.get('next')
  window.history.replaceState(null, '', window.location.pathname + window.location.search + (next && NEXT_PAGE.test(next) ? `#${next}` : ''))
  if (token) setToken(token)
  if (code) {
    try {
      const response = await fetch(`${API_BASE}/auth/link/redeem`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, app: 'naya' }) })
      const data = await response.json().catch(() => undefined) as { token?: string } | undefined
      if (!response.ok || !data?.token) return 'invalid_code'
      setToken(data.token)
    } catch {
      return 'daily_unreachable'
    }
  }
  return error
}
