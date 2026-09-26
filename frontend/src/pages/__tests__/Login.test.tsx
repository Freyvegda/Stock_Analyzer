import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Login from '../Login'
import { AuthProvider } from '../../auth/AuthContext'
import { Provider } from '../../components/ui/provider'

// The garden scene is three.js; its own suite covers the gates. Here it stays inert
// so jsdom keeps a real canvas out of the auth tests.
vi.mock('@/components/three/SakuraScene', () => ({
  default: () => <div data-testid="sakura-scene-mock" />,
}))

interface Stub {
  status?: number
  body?: unknown
  gate?: Promise<void>
}

const ANONYMOUS_ME = {
  'GET /api/auth/me': { status: 401, body: { detail: 'Not authenticated' } },
}

function stubFetch(handlers: Record<string, Stub>) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`
    const handler = handlers[key]
    if (!handler) throw new Error(`unexpected fetch: ${key}`)
    if (handler.gate) await handler.gate
    const status = handler.status ?? 200
    return {
      ok: status < 400,
      status,
      statusText: String(status),
      json: async () => handler.body,
    } as unknown as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderLogin() {
  return render(
    <Provider>
      <AuthProvider>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<div>fundamentals home</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </Provider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('Login', () => {
  it('shows the create-account card on first visit', async () => {
    stubFetch({
      ...ANONYMOUS_ME,
      'GET /api/auth/state': { body: { users_exist: false, user: null } },
    })
    renderLogin()
    expect(await screen.findByRole('button', { name: /create account/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument()
  })

  it('shows the login card once a user exists', async () => {
    stubFetch({
      ...ANONYMOUS_ME,
      'GET /api/auth/state': { body: { users_exist: true, user: null } },
    })
    renderLogin()
    expect(await screen.findByRole('button', { name: /^log in$/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/confirm password/i)).not.toBeInTheDocument()
  })

  it('lays the auth card over the sakura garden scene', async () => {
    stubFetch({
      ...ANONYMOUS_ME,
      'GET /api/auth/state': { body: { users_exist: true, user: null } },
    })
    renderLogin()
    expect(await screen.findByTestId('sakura-scene-mock')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: /log in/i })).toBeInTheDocument()
  })

  it('toggles password visibility without submitting', async () => {
    const fetchMock = stubFetch({
      ...ANONYMOUS_ME,
      'GET /api/auth/state': { body: { users_exist: true, user: null } },
    })
    renderLogin()
    const field = await screen.findByLabelText(/^password$/i)
    expect(field).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: /show password/i }))
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute('type', 'text')
    await userEvent.click(screen.getByRole('button', { name: /hide password/i }))
    expect(screen.getByLabelText(/^password$/i)).toHaveAttribute('type', 'password')
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/login', expect.anything())
  })

  it('rejects a mismatched confirmation locally', async () => {
    const fetchMock = stubFetch({
      ...ANONYMOUS_ME,
      'GET /api/auth/state': { body: { users_exist: false, user: null } },
    })
    renderLogin()
    await userEvent.type(await screen.findByLabelText(/username/i), 'solo')
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password1')
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'password2')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/passwords do not match/i)
    expect(fetchMock).not.toHaveBeenCalledWith('/api/auth/setup', expect.anything())
  })

  it('creates the account and navigates home', async () => {
    const fetchMock = stubFetch({
      ...ANONYMOUS_ME,
      'GET /api/auth/state': { body: { users_exist: false, user: null } },
      'POST /api/auth/setup': { status: 201, body: { id: 1, username: 'solo' } },
    })
    renderLogin()
    await userEvent.type(await screen.findByLabelText(/username/i), 'solo')
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password1')
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'password1')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText('fundamentals home')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/setup',
      expect.objectContaining({ body: '{"username":"solo","password":"password1"}' }),
    )
  })

  it('recovers from the setup race (409) by switching to the login card', async () => {
    stubFetch({
      ...ANONYMOUS_ME,
      'GET /api/auth/state': { body: { users_exist: false, user: null } },
      'POST /api/auth/setup': { status: 409, body: { detail: 'Account already exists' } },
    })
    renderLogin()
    await userEvent.type(await screen.findByLabelText(/username/i), 'solo')
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password1')
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'password1')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/account already exists/i)
    expect(screen.getByRole('button', { name: /^log in$/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/username/i)).toHaveValue('solo')
  })

  it('keeps the login card and shows the generic 401 detail', async () => {
    stubFetch({
      ...ANONYMOUS_ME,
      'GET /api/auth/state': { body: { users_exist: true, user: null } },
      'POST /api/auth/login': {
        status: 401,
        body: { detail: 'Invalid username or password' },
      },
    })
    renderLogin()
    await userEvent.type(await screen.findByLabelText(/username/i), 'solo')
    await userEvent.type(screen.getByLabelText(/^password$/i), 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: /^log in$/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid username or password/i)
    expect(screen.getByRole('button', { name: /^log in$/i })).toBeInTheDocument()
  })

  it('disables the submit button while the request is pending', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    stubFetch({
      ...ANONYMOUS_ME,
      'GET /api/auth/state': { body: { users_exist: false, user: null } },
      'POST /api/auth/setup': { status: 201, body: { id: 1, username: 'solo' }, gate },
    })
    renderLogin()
    await userEvent.type(await screen.findByLabelText(/username/i), 'solo')
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password1')
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'password1')
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    await waitFor(() => expect(screen.getByTestId('inline-spinner')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /working/i })).toBeDisabled()
    release()
    expect(await screen.findByText('fundamentals home')).toBeInTheDocument()
  })
})
