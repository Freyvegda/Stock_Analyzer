import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTH_UNAUTHORIZED_EVENT, api, ApiError } from '../client'

afterEach(() => vi.restoreAllMocks())

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
    const err = await api.post('/screen/config/reload', {}).catch((e: unknown) => e)
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
