/**
 * The access token lives here and nowhere else: module memory, never
 * `localStorage` and never a cookie. The HttpOnly refresh cookie is the only
 * durable credential, so an XSS payload cannot read a long-lived secret out of
 * storage.
 *
 * `refreshAccessToken` uses raw `fetch` on purpose. Going through `api.*` would
 * route the refresh call back through the very 401 handler that invoked it.
 */
const BASE = '/api'

let accessToken: string | null = null

/** The in-flight refresh, so N concurrent 401s cause exactly one request. */
let inFlight: Promise<boolean> | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string): void {
  // An empty string must never overwrite a live token: callers pass through
  // response bodies that may not contain one, and "Bearer " is not a credential.
  if (token) accessToken = token
}

export function clearAccessToken(): void {
  accessToken = null
}

async function doRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'same-origin',
    })
    if (!res.ok) {
      clearAccessToken()
      return false
    }
    const body: unknown = await res.json()
    const token =
      body !== null && typeof body === 'object' && 'access_token' in body
        ? (body as { access_token: unknown }).access_token
        : null
    if (typeof token !== 'string' || !token) {
      clearAccessToken()
      return false
    }
    accessToken = token
    return true
  } catch {
    clearAccessToken()
    return false
  }
}

/**
 * Exchange the refresh cookie for a new access token.
 *
 * Single-flighted, and that is not an optimisation: the server *rotates* the
 * refresh token, so five parallel calls would have four of them invalidate the
 * token the fifth just received. One request, one shared answer.
 */
export function refreshAccessToken(): Promise<boolean> {
  if (inFlight) return inFlight
  inFlight = doRefresh().finally(() => {
    inFlight = null
  })
  return inFlight
}
