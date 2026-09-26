import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from '../AuthContext'
import { api, ApiError, AUTH_UNAUTHORIZED_EVENT } from '../../api/client'

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

function Probe() {
  const { user, loading, logout } = useAuth()
  if (loading) return <div>loading</div>
  return (
    <div>
      <span>{user ? user.username : 'anonymous'}</span>
      <button onClick={() => void logout()}>sign out</button>
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

beforeEach(() => vi.resetAllMocks())

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
