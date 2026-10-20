import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

test('static route returns 404 for nested file path and an overlong path', async () => {
  const port = await new Promise((resolve) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const selected = probe.address().port
      probe.close(() => resolve(selected))
    })
  })
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), VIBE_APP_KEY: 'vibe_app_test' },
    stdio: 'ignore',
  })
  try {
    let ready = false
    for (let attempt = 0; attempt < 50; attempt++) {
      if (child.exitCode !== null) throw new Error('test server exited early')
      try {
        const health = await fetch(`http://127.0.0.1:${port}/health`)
        ready = health.ok
        if (ready) break
      } catch { /* server is starting */ }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    assert.equal(ready, true)
    for (const path of ['/app.js/x', `/${'x'.repeat(8000)}`]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`)
      assert.equal(response.status, 404)
    }
    for (const query of ['from=2026-02-31&to=2026-03-01', 'from=2026-03-01&to=2026-03-02&categoryId=9007199254740993']) {
      const response = await fetch(`http://127.0.0.1:${port}/api/dashboard?${query}`, {
        headers: { 'X-Vibe-Authorization': 'Bearer vibe_session_test' },
      })
      assert.equal(response.status, 400)
    }
  } finally {
    child.kill()
  }
})
