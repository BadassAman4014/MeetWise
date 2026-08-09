/* eslint-disable no-undef */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { handleSummarize } from './server/gemini.js'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'GEMINI_')
  process.env.GEMINI_API_KEY ||= env.GEMINI_API_KEY
  return {
  plugins: [
    react(),
    {
      name: 'gemini-api',
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          const pathname = request.url?.split('?')[0]
          if (pathname !== '/api/summarize') return next()
          await handleSummarize(request, response)
        })
      },
    },
  ],
  worker: { format: 'es' },
  }
})
