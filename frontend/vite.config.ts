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

/** Where the API actually listens. Matches backend/.env `PORT`. */
const API_TARGET = process.env.API_TARGET ?? 'http://localhost:3001'

/**
 * Serve the API under the same origin as the app, at `/api`.
 *
 * This is what makes a single tunnel enough. Without it the browser is told to
 * call `http://localhost:3001`, which resolves to *the visitor's own machine* —
 * so the app loads over ngrok and then reports it cannot reach the shop. Worse,
 * a tunnel is HTTPS, and a browser blocks a plain-HTTP call from an HTTPS page
 * regardless of what is listening there.
 *
 * Proxied instead, everything is same-origin: one URL to share, no second tunnel
 * to keep alive, no CORS, no mixed content. It also matches how this deploys in
 * production, where the SPA and the API sit behind one host — which is why
 * `lib/api.ts` already defaults to a relative `/api`.
 */
const apiProxy = {
  '/api': {
    target: API_TARGET,
    changeOrigin: false,
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Bind on all interfaces so a tunnel (or a phone on the same wifi) can reach it.
    host: true,
    allowedHosts: tunnelHosts,
    proxy: apiProxy,
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
    proxy: apiProxy,
  },
})
