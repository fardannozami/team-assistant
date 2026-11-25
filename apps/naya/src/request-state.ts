import { apiFetch } from './api.ts'

export type RequestState<T> =
  | { status: 'pending' }
  | { status: 'ready'; data: T; stale?: boolean }
  | { status: 'failed'; httpStatus?: number; message?: string }

/** Explains a failed request in terms the operator can act on. */
export function describeFailure(httpStatus: number | undefined, serverMessage?: string): string {
  if (httpStatus === undefined) return 'API daily tidak bisa dihubungi. Coba lagi sebentar lagi.'
  if (httpStatus === 404 && (!serverMessage || serverMessage === 'Not found')) return 'API daily belum mengenal endpoint ini (versi API lebih lama dari halaman ini). Deploy ulang API.'
  return serverMessage ? `${serverMessage} (HTTP ${httpStatus})` : `API daily menjawab HTTP ${httpStatus}.`
}

export async function loadSnapshot<T>(path: string, request: typeof fetch = apiFetch): Promise<RequestState<T>> {
  let response: Response
  try {
    response = await request(path)
  } catch {
    return { status: 'failed', message: describeFailure(undefined) }
  }
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { error?: unknown; locked?: unknown } | undefined
    const serverMessage = typeof body?.error === 'string' ? body.error : undefined
    return { status: 'failed', httpStatus: response.status, message: describeFailure(response.status, serverMessage) }
  }
  try {
    return { status: 'ready', data: await response.json() as T }
  } catch {
    return { status: 'failed', httpStatus: response.status, message: 'API daily mengirim respons yang bukan JSON. Periksa VITE_API_URL.' }
  }
}

/** Keeps the last good data visible (marked stale) when a background refresh fails. */
export function mergeRefresh<T>(previous: RequestState<T>, next: RequestState<T>): RequestState<T> {
  if (next.status === 'failed' && previous.status === 'ready') return { ...previous, stale: true }
  return next
}
