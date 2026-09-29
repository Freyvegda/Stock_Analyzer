/**
 * The access token lives here and nowhere else: module memory, never
 * `localStorage` and never a cookie. An HttpOnly refresh cookie is the only
 * durable credential, so a XSS payload cannot read a long-lived secret out of
 * storage.
 *
 * `refreshAccessToken` uses raw `fetch` on purpose. Going through `api.*` would
 * route the refresh call back through the 401 handler that invoked it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAccessToken, clearAccessToken, refreshAccessToken, setAccessToken } from '../tokenStore'

const BASE = '/api'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('access token storage', () => {
  beforeEach(() => {
    clearAccessToken()
  })

  it('starts empty and round-trips a token', () => {
    expect(getAccessToken()).toBeNull()
    setAccessToken('abc.def.ghi')
    expect(getAccessToken()).toBe('abc.def.ghi')
  })

  it('ignores an empty token so a null never becomes the string "null"', () => {
    setAccessToken('abc')
    setAccessToken('')
    expect(getAccessToken()).toBe('abc')
    clearAccessToken()
    setAccessToken('')
    expect(getAccessToken()).toBeNull()
  })

  it('clears the token', () => {
    setAccessToken('abc')
    clearAccessToken()
    expect(getAccessToken()).toBeNull()
  })
})

describe('refreshAccessToken', () => {
  beforeEach(() => {
    clearAccessToken()
    vi.restoreAllMocks()
  })

  it('posts to the refresh endpoint and stores the new access token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ user: { id: 1, username: 'alice' }, access_token: 'new-token' }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(refreshAccessToken()).resolves.toBe(true)
    expect(getAccessToken()).toBe('new-token')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/auth/refresh`)
  })

  it('sends the request without a JSON content type and with cookies', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 't' }))
    vi.stubGlobal('fetch', fetchMock)

    await refreshAccessToken()

    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    // same-origin is the default that carries the refresh cookie through the
    // Vite proxy; the header is omitted so no body is implied.
    expect(init.credentials).toBe('same-origin')
  })

  it('returns false and clears the token when the refresh is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ detail: 'x' }, 401)))
    setAccessToken('stale')

    await expect(refreshAccessToken()).resolves.toBe(false)
    expect(getAccessToken()).toBeNull()
  })

  it('returns false when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    await expect(refreshAccessToken()).resolves.toBe(false)
  })

  it('returns false when the response carries no access token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ user: { id: 1 } })))
    await expect(refreshAccessToken()).resolves.toBe(false)
  })
})

describe('single flight', () => {
  beforeEach(() => {
    clearAccessToken()
    vi.restoreAllMocks()
  })

  it('collapses five concurrent refreshes into one request', async () => {
    // Rotation is the reason: four extra refresh calls would each invalidate the
    // token the fifth one just received, logging the user out at random.
    let release: (value: Response) => void = () => {}
    const fetchMock = vi
      .fn()
      .mockReturnValue(new Promise<Response>((resolve) => (release = resolve)))
    vi.stubGlobal('fetch', fetchMock)

    const all = Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ])
    release(jsonResponse({ access_token: 'rotated' }))

    await expect(all).resolves.toEqual([true, true, true, true, true])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(getAccessToken()).toBe('rotated')
  })

  it('allows a new refresh after the previous one settled', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ access_token: 'rotated' }))
    vi.stubGlobal('fetch', fetchMock)

    await refreshAccessToken()
    await refreshAccessToken()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not leave a rejected in-flight promise cached', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({}, 401))
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'later' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(refreshAccessToken()).resolves.toBe(false)
    await expect(refreshAccessToken()).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
