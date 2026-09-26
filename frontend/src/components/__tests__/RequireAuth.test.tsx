import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RequireAuth } from '../RequireAuth'
import { AuthProvider } from '../../auth/AuthContext'
import { api, ApiError } from '../../api/client'

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

function renderGuard() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/login" element={<div>login page</div>} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <div>guard child</div>
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

beforeEach(() => vi.resetAllMocks())

describe('RequireAuth', () => {
  it('renders nothing while the session is loading', () => {
    mockedApi.get.mockReturnValue(new Promise(() => {}))
    renderGuard()
    expect(screen.queryByText('guard child')).not.toBeInTheDocument()
    expect(screen.queryByText('login page')).not.toBeInTheDocument()
  })

  it('redirects anonymous visitors to /login', async () => {
    mockedApi.get.mockRejectedValue(new ApiError(401, 'Not authenticated'))
    renderGuard()
    expect(await screen.findByText('login page')).toBeInTheDocument()
  })

  it('renders the guarded content for an authenticated user', async () => {
    mockedApi.get.mockResolvedValue({ id: 1, username: 'solo' })
    renderGuard()
    expect(await screen.findByText('guard child')).toBeInTheDocument()
  })
})
