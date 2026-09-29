/**
 * One-shot WebGL probe.
 *
 * The probe must *release* the context it creates. Browsers cap live contexts
 * (Chromium around 16) and silently drop the oldest when the cap is hit, which
 * shows up much later as a black canvas on some unrelated page. Creating a
 * context per call and letting it go is how a layout that re-renders on scroll
 * quietly eats the whole budget.
 */
export function hasWebGL(): boolean {
  let canvas: HTMLCanvasElement | null = null
  try {
    canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    return Boolean(gl)
  } catch {
    return false
  } finally {
    releaseContext(canvas)
  }
}

function releaseContext(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return
  const gl =
    canvas.getContext('webgl2') ??
    canvas.getContext('webgl') ??
    (canvas as HTMLCanvasElement & { __probeGl?: WebGLRenderingContext | null }).__probeGl
  // Guarded: a context without getExtension (or a stubbed one) must not throw
  // out of the finally block and mask the probe's own result.
  const ext = gl && typeof gl.getExtension === 'function'
    ? gl.getExtension('WEBGL_lose_context')
    : null
  if (ext && typeof ext.loseContext === 'function') ext.loseContext()
}
