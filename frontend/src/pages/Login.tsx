import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Box, Button, Field, Flex, Input, Spinner, Stack, Text } from '@chakra-ui/react'
import { ApiError, api } from '@/api/client'
import type { AuthState, AuthUser } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'

const MarketRingLoader = lazy(() => import('@/components/three/MarketRingLoader'))

type Phase = 'loading' | 'setup' | 'login'

export default function Login() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('loading')
  const [navigateHome, setNavigateHome] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let active = true
    api
      .get<AuthState>('/auth/state')
      .then((state) => {
        if (!active) return
        if (state.user) {
          setUser(state.user)
          setNavigateHome(true)
        } else {
          setPhase(state.users_exist ? 'login' : 'setup')
        }
      })
      .catch(() => {
        // Unreachable API: fall back to the login card rather than a blank page.
        if (active) setPhase('login')
      })
    return () => {
      active = false
    }
  }, [setUser])

  if (navigateHome) return <Navigate to="/" replace />

  const isSetup = phase === 'setup'

  function validate(): string | null {
    const name = username.trim()
    if (name.length < 3 || name.length > 32) return 'Username must be 3–32 characters'
    if (password.length < 8) return 'Password must be at least 8 characters'
    if (isSetup && password !== confirm) return 'Passwords do not match'
    return null
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    const problem = validate()
    if (problem !== null) {
      setError(problem)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const path = isSetup ? '/auth/setup' : '/auth/login'
      const user = await api.post<AuthUser>(path, { username: username.trim(), password })
      setUser(user)
      navigate('/')
    } catch (err) {
      if (isSetup && err instanceof ApiError && err.status === 409) {
        setError('Account already exists — log in instead')
        setPhase('login')
        setConfirm('')
      } else {
        setError(err instanceof ApiError ? err.detail : err instanceof Error ? err.message : 'Request failed')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (phase === 'loading') {
    return (
      <Flex minH="100vh" align="center" justify="center" px={6}>
        <Suspense fallback={null}>
          <MarketRingLoader size={120} label="Checking session…" />
        </Suspense>
      </Flex>
    )
  }

  return (
    <Flex minH="100vh" align="center" justify="center" px={6}>
      <Box borderWidth="1px" borderColor="border" rounded="lg" p={6} bg="bg.panel" w="full" maxW="sm">
        <Text fontSize="xl" fontWeight="semibold">
          {isSetup ? 'Create account' : 'Log in'}
        </Text>
        <Text fontSize="sm" color="fg.muted" mb={4}>
          {isSetup
            ? 'First visit — this account owns the tool.'
            : 'Sign in to reach the analysis pipeline.'}
        </Text>
        <form onSubmit={submit}>
          <Stack gap={4}>
            <Field.Root>
              <Field.Label>Username</Field.Label>
              <Input
                name="username"
                value={username}
                autoComplete="username"
                onChange={(e) => setUsername(e.target.value)}
              />
            </Field.Root>
            <Field.Root>
              <Field.Label>Password</Field.Label>
              <Input
                name="password"
                type="password"
                value={password}
                autoComplete={isSetup ? 'new-password' : 'current-password'}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field.Root>
            {isSetup ? (
              <Field.Root>
                <Field.Label>Confirm password</Field.Label>
                <Input
                  name="confirm-password"
                  type="password"
                  value={confirm}
                  autoComplete="new-password"
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </Field.Root>
            ) : null}
            {error !== null ? (
              <Text role="alert" color="fg.error" fontSize="sm">
                {error}
              </Text>
            ) : null}
            <Button
              type="submit"
              colorPalette="emerald"
              loading={submitting}
              loadingText="Working…"
              disabled={submitting}
              spinner={<Spinner data-testid="inline-spinner" size="sm" />}
            >
              {isSetup ? 'Create account' : 'Log in'}
            </Button>
          </Stack>
        </form>
      </Box>
    </Flex>
  )
}
