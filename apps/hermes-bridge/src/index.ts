import { createBridge } from './app.js'

// Only daily's API calls it. Defaults to localhost (development against a Hermes on this machine);
// the Hermes container sets BRIDGE_HOST=0.0.0.0 to listen on the Docker network "agents".
const token = process.env.BRIDGE_TOKEN ?? ''
if (token.length < 16) {
  console.error('hermes-bridge: set BRIDGE_TOKEN (at least 16 characters).')
  process.exit(1)
}
const port = Number(process.env.BRIDGE_PORT) || 8700
const hostname = process.env.BRIDGE_HOST || '127.0.0.1'

const app = createBridge({ token })
Bun.serve({ port, hostname, fetch: app.fetch, idleTimeout: 60 })
console.log(`hermes-bridge listening on http://${hostname}:${port}`)
