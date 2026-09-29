import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { AUTH_UNAUTHORIZED_EVENT, api } from '@/api/client'
import { clearAccessToken, getAccessToken, refreshAccessToken } from '@/auth/tokenStore'
import { useIdleLogout, IDLE_LOGOUT_MS } from '@/lib/useIdleLogout'
import type { AuthUser } from '@/api/types'

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  setUser: (user: AuthUser | null) => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true

    // The access token is memory-only, so a page load starts with none. If there
    // is nothing in memory, the refresh cookie is the only thing that can bring
    // the session back — try it first, and skip `/auth/me` entirely when it fails
    // rather than spending a request on a request we know will 401.
    const boot = async () => {
      if (getAccessToken() === null) {
        const restored = await refreshAccessToken()
        if (!active) return
        if (!restored) {
          setUser(null)
          setLoading(false)
          return
        }
      }
      try {
        const me = await api.get<AuthUser>('/auth/me')
        if (active) setUser(me)
      } catch {
        if (active) setUser(null)
      } finally {
        if (active) setLoading(false)
      }
    }
    void boot()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    // A 401 that survived a refresh means the session is genuinely over: the
    // token in memory is dead and must not be reused.
    const onUnauthorized = () => {
      clearAccessToken()
      setUser(null)
    }
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', undefined)
    } catch {
      // Deliberately swallowed. Callers do `void logout()`, so a rejected promise
      // would surface as an unhandled rejection. A failed revocation must still
      // read as a sign-out to the person who asked for one.
    } finally {
      clearAccessToken()
      setUser(null)
    }
  }, [])

  // 3h of real silence signs the user out. `user !== null` is the enabled gate,
  // so a new sign-in always gets a fresh window instead of inheriting a timer
  // that started while the login page was open.
  useIdleLogout(() => void logout(), IDLE_LOGOUT_MS, user !== null)

  const value = useMemo(
    () => ({ user, loading, setUser, logout }),
    [user, loading, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (context === null) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
