import { createContext, useContext } from 'react'
import { apiFetch, LOCKED_EVENT } from './api.ts'

// The signed-in person (daily account) and what they may do in Naya. The API checks again.

export { LOCKED_EVENT }

/** `employeeId`: their team member record, when their account is linked to one (then they can be a PIC). */
export interface SessionUser { id: string; name: string; email: string; role: string | null; employeeId?: string | null }
/** `see`: the pages a role may open (blueprint v3 access matrix); the API enforces the same. */
export interface Permissions { instruct: boolean; review: boolean; comment: boolean; manageAgents: boolean; chat: string[]; see: { allTasks: boolean; agents: boolean; calendar: boolean; usage: boolean } }
export interface NayaAgent { profile: string; displayName: string; description: string | null; chatRoles: string[]; isLead: boolean; hasKey: boolean }
export interface Me { user: SessionUser; can: Permissions; agents: NayaAgent[]; hermes: boolean }

export const MeContext = createContext<Me | null>(null)
export const useMe = () => useContext(MeContext)

/** undefined: the API could not be reached; null: not signed in. */
export async function loadMe(request: typeof fetch = apiFetch): Promise<Me | null | undefined> {
  try {
    const response = await request('/api/me')
    if (response.status === 401) return null
    return response.ok ? await response.json() as Me : undefined
  } catch {
    return undefined
  }
}

export type PostResult<T> = { ok: true; data: T } | { ok: false; message: string; status?: number }

export async function apiPost<T = { ok: true }>(path: string, body: Record<string, unknown> = {}, request: typeof fetch = apiFetch): Promise<PostResult<T>> {
  try {
    const response = await request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const data = await response.json().catch(() => undefined) as (T & { error?: string }) | undefined
    if (!response.ok || !data) return { ok: false, status: response.status, message: data?.error ?? `API menjawab HTTP ${response.status}.` }
    return { ok: true, data }
  } catch {
    return { ok: false, message: 'API daily tidak bisa dihubungi.' }
  }
}

/** Messages for the `#auth_error=` daily sends back. */
export const AUTH_ERRORS: Record<string, string> = {
  invalid_code: 'Link masuk sudah kedaluwarsa atau sudah dipakai. Minta link baru (ketik NAYA ke bot WhatsApp) atau masuk dengan Google.',
  not_registered: 'Akun Google ini belum terdaftar di daily. Minta admin mengundang email Anda.',
  unverified_email: 'Email Google Anda belum terverifikasi.',
  cancelled: 'Masuk dibatalkan.',
  invalid_state: 'Sesi masuk kedaluwarsa. Coba lagi.',
  google_error: 'Google sedang bermasalah. Coba lagi sebentar lagi.',
  daily_unreachable: 'API daily tidak bisa dihubungi. Coba lagi sebentar lagi.',
}
