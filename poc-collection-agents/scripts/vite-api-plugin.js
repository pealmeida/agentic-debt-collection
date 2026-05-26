import { loadEnv } from 'vite'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const API_ROUTES = {
  '/api/orchestrate': resolve(projectRoot, 'api/orchestrate.js'),
  '/api/healthz': resolve(projectRoot, 'api/healthz.js'),
}

function createVercelResponse(nodeRes) {
  let statusCode = 200

  const res = {
    status(code) {
      statusCode = code
      return res
    },
    json(data) {
      nodeRes.statusCode = statusCode
      nodeRes.setHeader('Content-Type', 'application/json')
      nodeRes.end(JSON.stringify(data))
      return res
    },
    setHeader(name, value) {
      nodeRes.setHeader(name, value)
      return res
    },
    write(chunk) {
      if (!nodeRes.headersSent) nodeRes.writeHead(statusCode)
      nodeRes.write(chunk)
      return true
    },
    end(chunk) {
      if (chunk) res.write(chunk)
      nodeRes.end()
    },
    flushHeaders() {
      if (!nodeRes.headersSent) nodeRes.writeHead(statusCode)
    },
  }

  return res
}

async function readJsonBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString()
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export function viteApiPlugin(mode) {
  return {
    name: 'vite-api-routes',
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), '')
      for (const [key, value] of Object.entries(env)) {
        if (value !== undefined && value !== '') process.env[key] = value
      }

      server.middlewares.use(async (req, res, next) => {
        const pathname = req.url?.split('?')[0]
        const modulePath = API_ROUTES[pathname]
        if (!modulePath) return next()

        if (req.method === 'OPTIONS') {
          res.statusCode = 204
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
          res.end()
          return
        }

        try {
          const { default: handler } = await server.ssrLoadModule(modulePath)
          const body = req.method === 'POST' || req.method === 'PUT' ? await readJsonBody(req) : undefined

          await handler(
            {
              method: req.method,
              headers: req.headers,
              body,
            },
            createVercelResponse(res),
          )
        } catch (err) {
          console.error(`[vite-api] ${pathname}:`, err)
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: err.message || 'Internal server error' }))
          }
        }
      })
    },
  }
}
