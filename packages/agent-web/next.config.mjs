/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Next 16 auto-writes AGENTS.md/CLAUDE.md into the package on dev; keep the
  // committed file surface deterministic instead. Next 16 guidance lives in
  // node_modules/next/dist/docs/ when needed.
  agentRules: false,
  // Hide the dev-only overlay badge so it does not sit over the sidebar footer.
  devIndicators: false,

  /**
   * Serve the agent API from this same origin.
   *
   * Set AGENT_API_INTERNAL_URL (server-side, e.g. http://127.0.0.1:8787) and
   * every /v1 and /healthz request is proxied to it. The browser then talks to
   * one origin only, which means the client needs no configured backend
   * address, there is no CORS preflight, and the session cookie is first-party
   * rather than a cross-site one that browsers increasingly block.
   *
   * Unset (the default) leaves the app talking to whatever the client resolves
   * on its own.
   */
  async rewrites() {
    // Standalone production deployments keep the API beside the web process.
    // A build-time fallback makes the same-origin proxy deterministic even
    // when the service environment is only available at runtime.
    const target =
      process.env.AGENT_API_INTERNAL_URL?.trim() ||
      (process.env.NODE_ENV === 'production' ? 'http://127.0.0.1:8787' : '')
    if (!target) {
      return []
    }
    const base = target.replace(/\/+$/, '')
    return [
      { source: '/healthz', destination: `${base}/healthz` },
      { source: '/v1/:path*', destination: `${base}/v1/:path*` },
    ]
  },
}

export default nextConfig
