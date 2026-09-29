import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTH_UNAUTHORIZED_EVENT, api, ApiError } from '../client'
import { clearAccessToken, setAccessToken } from '@/auth/tokenStore'

afterEach(() => {
  vi.restoreAllMocks()
  clearAccessToken()
})

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
}

describe('api client', () => {
  it('returns parsed JSON on success', async () => {
    mockFetch({ ok: true, status: 200, json: async () => ({ hello: 'world' }) })
    await expect(api.get<{ hello: string }>('/thing')).resolves.toEqual({ hello: 'world' })
  })

  it('throws ApiError with backend detail', async () => {
    mockFetch({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      json: async () => ({ detail: 'pe_max must be a number' }),
    })
    const err = await api.post('/screen/criteria', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(422)
    expect((err as Error).message).toContain('pe_max must be a number')
  })

  it('falls back to status text when the body is not JSON', async () => {
    mockFetch({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => {
        throw new Error('not json')
      },
    })
    const err = await api.get('/screen/latest').catch((e: unknown) => e)
    expect((err as Error).message).toContain('500')
  })

  it('sends PUT with a JSON body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)
    await api.put('/screen/criteria', { criteria: [] })
    expect(fetchMock).toHaveBeenCalledWith('/api/screen/criteria', {
      method: 'PUT',
      body: '{"criteria":[]}',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    })
  })

  it('resolves undefined for 204 responses', async () => {
    mockFetch({ ok: true, status: 204 })
    await expect(api.post('/auth/logout', undefined)).resolves.toBeUndefined()
  })

  it('dispatches auth:unauthorized on a 401', async () => {
    mockFetch({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ detail: 'Not authenticated' }),
    })
    const listener = vi.fn()
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, listener)
    await api.get('/screen/latest').catch(() => {})
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, listener)
    expect(listener).toHaveBeenCalledOnce()
  })

  it('does not dispatch auth:unauthorized for login and setup 401s', async () => {
    mockFetch({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ detail: 'Invalid username or password' }),
    })
    const listener = vi.fn()
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, listener)
    await api.post('/auth/login', {}).catch(() => {})
    await api.post('/auth/setup', {}).catch(() => {})
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, listener)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('bearer token', () => {
  it('sends no Authorization header when there is no access token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    await api.get('/stocks')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('attaches the access token as a bearer header', async () => {
    setAccessToken('tok-123')
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) })
    vi.stubGlobal('fetch', fetchMock)

    await api.get('/stocks')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123')
    // the JSON content type must survive alongside it
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('does not attach a token to the login call that just failed', async () => {
    mockFetch({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: async () => ({ detail: 'Invalid username or password' }),
    })
    const fetchMock = vi.mocked(fetch)
    await api.post('/auth/login', { username: 'alice', password: 'nope' }).catch(() => {})
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })
})

describe('401 refresh and replay', () => {
  /** Route by URL suffix. Handlers are per-call, so they can answer differently each time. */
  function routeFetch(handlers: Record<string, (call: number) => Response>) {
    const counts: Record<string, number> = {}
    return vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      const key = Object.keys(handlers).find((k) => url.endsWith(k))
      if (!key) throw new Error(`unexpected fetch: ${url}`)
      counts[key] = (counts[key] ?? 0) + 1
      return Promise.resolve(handlers[key](counts[key]))
    })
  }

  const unauthorized = () =>
    new Response(JSON.stringify({ detail: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })

  const ok = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

  /** 401 on the first call, 200 on the replay — the real expiry-then-recover path. */
  const expiresThenOk =
    (body: unknown) =>
    (call: number): Response =>
      call === 1 ? unauthorized() : ok(body)

  it('refreshes once and replays the original request', async () => {
    setAccessToken('expired-token')
    const fetchMock = routeFetch({
      '/auth/refresh': () => ok({ user: { id: 1, username: 'alice' }, access_token: 'fresh' }),
      '/screen/latest': expiresThenOk({ run: null }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(api.get('/screen/latest')).resolves.toEqual({ run: null })
    // exactly one refresh between the original and its replay — no retry storm
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('replays with the newly issued token', async () => {
    setAccessToken('expired-token')
    const fetchMock = routeFetch({
      '/auth/refresh': () => ok({ access_token: 'fresh' }),
      '/screen/latest': expiresThenOk({}),
    })
    vi.stubGlobal('fetch', fetchMock)

    await api.get('/screen/latest')
    // order: original, refresh, replay
    const replay = fetchMock.mock.calls[2][1] as RequestInit
    expect((replay.headers as Record<string, string>).Authorization).toBe('Bearer fresh')
  })

  it('replays the original method and body', async () => {
    setAccessToken('expired-token')
    const fetchMock = routeFetch({
      '/auth/refresh': () => ok({ access_token: 'fresh' }),
      '/screen/criteria': expiresThenOk({ saved: true }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await api.put('/screen/criteria', { criteria: [] })
    // order: original, refresh, replay
    const replay = fetchMock.mock.calls[2][1] as RequestInit
    expect(replay.method).toBe('PUT')
    expect(replay.body).toBe('{"criteria":[]}')
  })

  it('replays only once: a second 401 is surfaced, not retried forever', async () => {
    setAccessToken('expired-token')
    let resourceCalls = 0
    const fetchMock = routeFetch({
      '/auth/refresh': () => ok({ access_token: 'fresh' }),
      '/screen/latest': () => {
        resourceCalls += 1
        return unauthorized() // never recovers
      },
    })
    vi.stubGlobal('fetch', fetchMock)

    const err = await api.get('/screen/latest').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(401)
    expect(resourceCalls).toBe(2) // the original plus exactly one replay, no loop
  })

  it('dispatches auth:unauthorized and throws when the refresh itself fails', async () => {
    setAccessToken('expired-token')
    const fetchMock = routeFetch({
      '/auth/refresh': () => unauthorized(),
      '/screen/latest': () => unauthorized(),
    })
    vi.stubGlobal('fetch', fetchMock)

    const listener = vi.fn()
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, listener)
    const err = await api.get('/screen/latest').catch((e: unknown) => e)
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, listener)

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(401)
    expect(listener).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledTimes(2) // the resource, then one refresh
  })

  it('does not attempt a refresh for a non-401', async () => {
    setAccessToken('tok')
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ detail: 'boom' }), { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    await api.get('/screen/latest').catch(() => {})
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not attempt a refresh for a login 401', async () => {
    const fetchMock = routeFetch({ '/auth/login': () => unauthorized() })
    vi.stubGlobal('fetch', fetchMock)

    await api.post('/auth/login', {}).catch(() => {})
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('collapses concurrent 401s into a single refresh', async () => {
    setAccessToken('expired-token')
    let resourceCalls = 0
    let refreshCalls = 0
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1
        return Promise.resolve(ok({ access_token: 'fresh' }))
      }
      resourceCalls += 1
      return resourceCalls <= 3
        ? Promise.resolve(unauthorized()) // first wave: three parallel 401s
        : Promise.resolve(ok({ ok: true }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const results = await Promise.allSettled([
      api.get('/a'),
      api.get('/b'),
      api.get('/c'),
    ])
    expect(refreshCalls).toBe(1)
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
  })
})
