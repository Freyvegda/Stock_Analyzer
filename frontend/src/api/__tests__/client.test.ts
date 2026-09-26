import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from '../client'

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
})
