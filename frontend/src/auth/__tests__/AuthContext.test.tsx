import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../AuthContext'
import { api, ApiError, AUTH_UNAUTHORIZED_EVENT } from '../../api/client'
import * as tokenStoreModule from '../tokenStore'
import { clearAccessToken, getAccessToken, setAccessToken } from '../tokenStore'

vi.mock('../../api/client', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
  ApiError: class ApiError extends Error {
    status: number
    detail: string
    constructor(status: number, detail: string) {
      super(`API error ${status}: ${detail}`)
      this.status = status
      this.detail = detail
    }
  },
  AUTH_UNAUTHORIZED_EVENT: 'auth:unauthorized',
}))

const mockedApi = vi.mocked(api)

/** Captured so a test can await the logout promise the button produced. */
let lastLogout: Promise<void> | null = null

function Probe() {
  const { user, loading, logout } = useAuth()
  if (loading) return <div>loading</div>
  return (
    <div>
      <span>{user ? user.username : 'anonymous'}</span>
      <button onClick={() => { lastLogout = logout() }}>sign out</button>
    </div>
  )
}

function renderProbe() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  clearAccessToken()
  // The re-bootstrap calls /auth/refresh through tokenStore's raw fetch.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: { id: 1, username: 'solo' }, access_token: 'restored' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
})

describe('AuthContext', () => {
  it('resolves the user from GET /auth/me', async () => {
    mockedApi.get.mockResolvedValue({ id: 1, username: 'solo' })
    renderProbe()
    expect(await screen.findByText('solo')).toBeInTheDocument()
    expect(mockedApi.get).toHaveBeenCalledWith('/auth/me')
  })

  it('treats a 401 as anonymous without surfacing an error', async () => {
    mockedApi.get.mockRejectedValue(new ApiError(401, 'Not authenticated'))
    renderProbe()
    expect(await screen.findByText('anonymous')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('clears the user when auth:unauthorized fires', async () => {
    mockedApi.get.mockResolvedValue({ id: 1, username: 'solo' })
    renderProbe()
    await screen.findByText('solo')
    act(() => window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT)))
    expect(await screen.findByText('anonymous')).toBeInTheDocument()
  })

  it('logout posts to /auth/logout and clears the user', async () => {
    mockedApi.get.mockResolvedValue({ id: 1, username: 'solo' })
    mockedApi.post.mockResolvedValue(undefined)
    renderProbe()
    await screen.findByText('solo')
    await userEvent.setup().click(screen.getByRole('button', { name: /sign out/i }))
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/logout', undefined)
    expect(await screen.findByText('anonymous')).toBeInTheDocument()
  })
})

describe('AuthContext re-bootstrap', () => {
  it('recovers a session from the refresh cookie on a fresh page load', async () => {
    // The access token is memory-only, so every reload starts with none. The
    // refresh cookie is the only thing that can restore the session.
    setAccessToken('restored')
    mockedApi.get.mockResolvedValue({ id: 1, username: 'solo' })
    renderProbe()
    expect(await screen.findByText('solo')).toBeInTheDocument()
  })

  it('stores the access token the refresh hands back', async () => {
    const spy = vi.spyOn(tokenStoreModule, 'refreshAccessToken')
    renderProbe()
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(getAccessToken()).not.toBeNull()
  })

  it('treats a failed refresh as anonymous, without calling /auth/me', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 401 })),
    )
    renderProbe()
    expect(await screen.findByText('anonymous')).toBeInTheDocument()
    expect(mockedApi.get).not.toHaveBeenCalled()
  })

  it('skips the refresh when a token is already in memory', async () => {
    setAccessToken('already-here')
    mockedApi.get.mockResolvedValue({ id: 1, username: 'solo' })
    renderProbe()
    expect(await screen.findByText('solo')).toBeInTheDocument()
    // no cookie exchange needed; the token in memory is still valid
    expect(fetch).not.toHaveBeenCalled()
  })

  it('clears the access token on logout', async () => {
    setAccessToken('live')
    mockedApi.get.mockResolvedValue({ id: 1, username: 'solo' })
    mockedApi.post.mockResolvedValue(undefined)
    renderProbe()
    await screen.findByText('solo')
    await userEvent.setup().click(screen.getByRole('button', { name: /sign out/i }))
    expect(await screen.findByText('anonymous')).toBeInTheDocument()
    expect(getAccessToken()).toBeNull()
  })

  it('clears the access token when auth:unauthorized fires', async () => {
    setAccessToken('live')
    mockedApi.get.mockResolvedValue({ id: 1, username: 'solo' })
    renderProbe()
    await screen.findByText('solo')
    act(() => window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT)))
    await screen.findByText('anonymous')
    expect(getAccessToken()).toBeNull()
  })

  it('signs out even when the logout request fails, without rejecting', async () => {
    setAccessToken('live')
    mockedApi.get.mockResolvedValue({ id: 1, username: 'solo' })
    mockedApi.post.mockRejectedValue(new ApiError(500, 'boom'))
    renderProbe()
    await screen.findByText('solo')
    await userEvent.setup().click(screen.getByRole('button', { name: /sign out/i }))
    expect(await screen.findByText('anonymous')).toBeInTheDocument()
    expect(getAccessToken()).toBeNull()
    // callers write `void logout()`, so this must not become an unhandled rejection
    await expect(lastLogout).resolves.toBeUndefined()
  })
})
