/**
 * Fixed vault texture layer: scanlines + blossom radial glow (dark) / petal grain (light).
 * Purely decorative — sits under `Bonfire` and never intercepts pointer events.
 */
export function Backdrop() {
  return (
    <div
      aria-hidden="true"
      data-testid="vault-backdrop"
      className="vault-backdrop pointer-events-none fixed inset-0 -z-10"
    />
  )
}
