import { lazy, Suspense, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Box, Button, Field, Flex, IconButton, Input, Spinner, Stack, Text } from '@chakra-ui/react'
import { Eye, EyeOff } from 'lucide-react'
import { ApiError, api } from '@/api/client'
import type { AuthState, AuthUser } from '@/api/types'
import { useAuth } from '@/auth/AuthContext'
import { BlurFade } from '@/components/ui/BlurFade'
import { LoginBrandPanel } from '@/components/LoginBrandPanel'
import { LoginGarden } from '@/components/LoginGarden'

const SakuraLeafLoader = lazy(() => import('@/components/three/SakuraLeafLoader'))

type Phase = 'loading' | 'setup' | 'login'

/** One staggered row of the auth card (DESIGN.md: first-load 12ms stagger, cap 8). */
function AuthRow({ index, children }: { index: number; children: ReactNode }) {
  return (
    <div className="vault-row-in" style={{ '--row-index': index } as CSSProperties}>
      {children}
    </div>
  )
}

export default function Login() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('loading')
  const [navigateHome, setNavigateHome] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [visible, setVisible] = useState(false)
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
          <SakuraLeafLoader size={120} label="Checking session…" />
        </Suspense>
      </Flex>
    )
  }

  return (
    <Box minH="100vh" position="relative" overflow="hidden">
      <LoginGarden />

      <Flex
        minH="100vh"
        position="relative"
        zIndex={1}
        align="center"
        justify="center"
        px={{ base: 5, md: 8 }}
        py={{ base: 12, lg: 16 }}
      >
        <Flex
          w="full"
          maxW="5xl"
          gap={{ base: 0, lg: 16 }}
          align="center"
          justify="center"
          direction={{ base: 'column', lg: 'row' }}
        >
          <LoginBrandPanel />

          <BlurFade>
            <Box
              as="section"
              aria-labelledby="auth-heading"
              position="relative"
              w={{ base: 'full', md: 'md' }}
              borderWidth="1px"
              borderColor="border"
              rounded="lg"
              bg="bg.panel"
              boxShadow="xl"
              overflow="hidden"
            >
              <Box
                aria-hidden="true"
                position="absolute"
                insetX={0}
                top={0}
                h="1px"
                bgGradient="to-r"
                gradientFrom="transparent"
                gradientVia="primary"
                gradientTo="transparent"
              />
              <Stack gap={6} p={{ base: 6, md: 8 }}>
                <Stack gap={1}>
                  <Text as="h1" id="auth-heading" fontSize="2xl" fontWeight="semibold">
                    {isSetup ? 'Create account' : 'Log in'}
                  </Text>
                  <Text fontSize="sm" color="fg.muted">
                    {isSetup
                      ? 'First visit — this account owns the tool.'
                      : 'Sign in to reach the analysis pipeline.'}
                  </Text>
                </Stack>

                <form onSubmit={submit}>
                  <Stack gap={4}>
                    <AuthRow index={0}>
                      <Field.Root>
                        <Field.Label>Username</Field.Label>
                        <Input
                          name="username"
                          value={username}
                          autoComplete="username"
                          onChange={(e) => setUsername(e.target.value)}
                        />
                      </Field.Root>
                    </AuthRow>

                    <AuthRow index={1}>
                      <Field.Root>
                        <Field.Label>Password</Field.Label>
                        <Box position="relative">
                          <Input
                            name="password"
                            type={visible ? 'text' : 'password'}
                            value={password}
                            pe={10}
                            autoComplete={isSetup ? 'new-password' : 'current-password'}
                            onChange={(e) => setPassword(e.target.value)}
                          />
                          <IconButton
                            type="button"
                            aria-label={visible ? 'Hide password' : 'Show password'}
                            aria-pressed={visible}
                            variant="ghost"
                            size="xs"
                            position="absolute"
                            top="50%"
                            right={1}
                            transform="translateY(-50%)"
                            onClick={() => setVisible((current) => !current)}
                          >
                            {visible ? (
                              <EyeOff size={16} strokeWidth={1.75} aria-hidden="true" />
                            ) : (
                              <Eye size={16} strokeWidth={1.75} aria-hidden="true" />
                            )}
                          </IconButton>
                        </Box>
                      </Field.Root>
                    </AuthRow>

                    {isSetup ? (
                      <AuthRow index={2}>
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
                      </AuthRow>
                    ) : null}

                    {error !== null ? (
                      <Text role="alert" color="fg.error" fontSize="sm">
                        {error}
                      </Text>
                    ) : null}

                    <AuthRow index={3}>
                      <Button
                        type="submit"
                        colorPalette="sakura"
                        width="full"
                        loading={submitting}
                        loadingText="Working…"
                        disabled={submitting}
                        spinner={<Spinner data-testid="inline-spinner" size="sm" />}
                      >
                        {isSetup ? 'Create account' : 'Log in'}
                      </Button>
                    </AuthRow>
                  </Stack>
                </form>

                <Text
                  fontFamily="mono"
                  fontSize="11px"
                  letterSpacing="0.08em"
                  textTransform="uppercase"
                  color="fg.muted"
                >
                  Session · HttpOnly cookie
                </Text>
              </Stack>
            </Box>
          </BlurFade>
        </Flex>
      </Flex>
    </Box>
  )
}
