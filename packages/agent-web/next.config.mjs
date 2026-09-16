/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Next 16 auto-writes AGENTS.md/CLAUDE.md into the package on dev; keep the
  // committed file surface deterministic instead. Next 16 guidance lives in
  // node_modules/next/dist/docs/ when needed.
  agentRules: false,
  // Hide the dev-only overlay badge so it does not sit over the sidebar footer.
  devIndicators: false,
}

export default nextConfig
