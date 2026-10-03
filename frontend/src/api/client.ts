import { getAccessToken, refreshAccessToken } from '@/auth/tokenStore'

const BASE = '/api'

export const AUTH_UNAUTHORIZED_EVENT = 'auth:unauthorized'

// Login/setup handle their own 401s inline; dispatching the global event would
// clear auth state and redirect away from the form. They must also skip the
// refresh: a 401 there means the password was wrong, not that the session died.
const AUTH_ENTRY_PATHS = new Set(['/auth/login', '/auth/setup'])

export class ApiError extends Error {
  status: number
  detail: string

  constructor(status: number, detail: string) {
    super(`API error ${status}: ${detail}`)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json()
    if (
      body !== null &&
      typeof body === 'object' &&
      'detail' in body &&
      typeof (body as { detail: unknown }).detail === 'string'
    ) {
      return (body as { detail: string }).detail
    }
  } catch {
    // Not a JSON body; fall back to the status text.
  }
  return res.statusText
}

/** Send the in-memory access token, if there is one. */
function authHeaders(): Record<string, string> {
  const token = getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...init?.headers },
  })
}

async function request<T>(path: string, init?: RequestInit, isReplay = false): Promise<T> {
  const res = await send(path, init)
  if (!res.ok) {
    const detail = await errorDetail(res)
    if (res.status === 401 && !AUTH_ENTRY_PATHS.has(path)) {
      // A 401 means the 15-minute access token expired, which is the normal
      // mid-session event — try the refresh cookie once and replay. If that
      // fails the session is genuinely over.
      if (!isReplay && (await refreshAccessToken())) {
        return request<T>(path, init, true)
      }
      window.dispatchEvent(new Event(AUTH_UNAUTHORIZED_EVENT))
    }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
