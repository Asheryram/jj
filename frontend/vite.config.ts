import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Hosts allowed to reach the dev/preview server.
 *
 * Vite blocks unknown Host headers by default as DNS-rebinding protection. A
 * leading dot matches the domain and every subdomain, so these survive a tunnel
 * restart — ngrok's free URLs change every session, and pinning one exact
 * hostname would break tomorrow.
 *
 * Set DEMO_HOST for a tunnel provider that is not listed here.
 */
const tunnelHosts = [
  '.ngrok-free.app',
  '.ngrok-free.dev',
  '.ngrok.app',
  '.ngrok.io',
  '.trycloudflare.com',
  '.loca.lt',
  '.serveo.net',
  ...(process.env.DEMO_HOST ? [process.env.DEMO_HOST] : []),
]

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Bind on all interfaces so a tunnel (or a phone on the same wifi) can reach it.
    host: true,
    allowedHosts: tunnelHosts,
    hmr: {
      // Through an HTTPS tunnel the browser must open the HMR socket on 443,
      // not on 5173. Left unset, the socket fails and hot reload dies silently.
      clientPort: process.env.DEMO_TUNNEL ? 443 : undefined,
      protocol: process.env.DEMO_TUNNEL ? 'wss' : undefined,
    },
  },
  preview: {
    host: true,
    allowedHosts: tunnelHosts,
  },
})
