import { afterEach, describe, expect, it, vi } from 'vitest'
import { consumeAuthRedirect } from './api.ts'

// A minimal window: the address and history.replaceState (jsdom is not used in these tests).
function fakeWindow(hash: string) {
  const location = { hash, pathname: '/', search: '' }
  vi.stubGlobal('window', {
    location,
    history: { replaceState: (_state: unknown, _title: string, url: string) => { location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : '' } },
  })
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
  return location
}

describe('sign-in links', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('redeems a WhatsApp handover link and opens the card it names', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ token: 'jwt' }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    const location = fakeWindow('#login=ta_login_abc&next=%2Fmy-tasks%2Fdefault%2Ft_9')
    expect(await consumeAuthRedirect()).toBeUndefined()
    expect(location.hash).toBe('#/my-tasks/default/t_9')
    expect(JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ code: 'ta_login_abc', app: 'naya' })
  })

  it('never follows a "next" that is not a page of Naya', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ token: 'jwt' }), { status: 200 })))
    const location = fakeWindow('#login=ta_login_abc&next=' + encodeURIComponent('//evil.example/x'))
    await consumeAuthRedirect()
    expect(location.hash).toBe('')
  })

  it('keeps the card when the code was already used, so signing in again lands there', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'x' }), { status: 401 })))
    const location = fakeWindow('#login=ta_login_old&next=%2Fmy-tasks%2Fdefault%2Ft_9')
    expect(await consumeAuthRedirect()).toBe('invalid_code')
    expect(location.hash).toBe('#/my-tasks/default/t_9')
  })
})
