// Minimal forward proxy for the managed-launch verification.
//
// It records every request it sees, so a test can prove that traffic really travelled through the
// configured proxy instead of falling back to a direct connection. Both HTTP absolute-form requests
// and HTTPS CONNECT tunnels are supported, with optional Basic proxy authentication.
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'

export function startProxyServer(options = {}) {
  const { username, password } = options
  const expected = username === undefined ? undefined : `Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}`
  const entries = []
  const sockets = new Set()

  const isAuthorized = request => expected === undefined || request.headers['proxy-authorization'] === expected

  const server = createServer((request, response) => {
    const target = request.url ?? ''
    const authorized = isAuthorized(request)
    entries.push({ kind: 'request', method: request.method ?? 'GET', target, authorized })
    if (!authorized) {
      response.writeHead(407, { 'proxy-authenticate': 'Basic realm="verify"' })
      response.end('proxy authentication required')
      return
    }
    let url
    try {
      url = new URL(target)
    } catch {
      response.writeHead(400)
      response.end('proxy expects an absolute target URL')
      return
    }
    const upstream = httpRequest({
      hostname: url.hostname,
      port: url.port === '' ? 80 : Number(url.port),
      path: `${url.pathname}${url.search}`,
      method: request.method,
      headers: request.headers,
    }, upstreamResponse => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers)
      upstreamResponse.pipe(response)
    })
    upstream.on('error', error => {
      response.writeHead(502)
      response.end(`upstream failed: ${error.message}`)
    })
    request.pipe(upstream)
  })

  server.on('connect', (request, socket, head) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    const target = request.url ?? ''
    const authorized = isAuthorized(request)
    entries.push({ kind: 'connect', target, authorized })
    if (!authorized) {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="verify"\r\n\r\n')
      return
    }
    const separator = target.lastIndexOf(':')
    const host = target.slice(0, separator)
    const port = Number(target.slice(separator + 1))
    const upstream = connect(port, host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length > 0) upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        entries,
        reset: () => { entries.length = 0 },
        close: () => new Promise(done => {
          for (const socket of sockets) socket.destroy()
          server.close(() => done())
        }),
      })
    })
  })
}
