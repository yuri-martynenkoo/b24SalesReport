import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAnalytics } from './analytics.js'

const PORT = Number(process.env.PORT) || 3000
const VIBE_API = process.env.VIBE_API_URL || 'https://vibecode.bitrix24.tech'
// `vibe_app_local` is the project secret name. The uppercase alias keeps local
// deployments compatible with conventional environment naming.
const VIBE_APP_KEY = process.env.vibe_app_local || process.env.VIBE_APP_KEY
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url))
const MAX_DEALS = 5000
const VIBE_SERVER_ID = process.env.VIBE_SERVER_ID || 'bb4fa4c9-bdd8-43eb-ac36-01318e09a47c'

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`)
    if (url.pathname === '/health') return json(response, 200, { ok: true })
    if (url.pathname === '/api/dashboard') return await handleDashboard(request, response, url)
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'Method not allowed' })
    return serveStatic(response, url.pathname, request.method === 'HEAD')
  } catch (error) {
    console.error('request_failed', safeError(error))
    return json(response, error.statusCode || 500, {
      error: error.publicMessage || 'Не удалось загрузить аналитику. Попробуйте ещё раз.',
      code: error.code || 'INTERNAL_ERROR',
    })
  }
})

server.listen(PORT, '0.0.0.0', () => console.log(`b24-sales-report listening on ${PORT}`))

async function handleDashboard(request, response, url) {
  if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' })
  if (!VIBE_APP_KEY || !VIBE_APP_KEY.startsWith('vibe_app_')) {
    throw publicError(503, 'APP_KEY_MISSING', 'Секрет vibe_app_local не настроен на сервере.')
  }

  const bearer = extractBearer(request.headers['x-vibe-authorization'])
  if (!bearer) throw publicError(401, 'AUTH_REQUIRED', 'Откройте приложение из Битрикс24 и авторизуйтесь повторно.')

  const { from, to } = validatePeriod(url.searchParams.get('from'), url.searchParams.get('to'))
  const selectedCategoryId = validateCategory(url.searchParams.get('categoryId'))
  const headers = { 'X-Api-Key': VIBE_APP_KEY, Authorization: `Bearer ${bearer}` }
  const [meEnvelope, categoriesEnvelope] = await Promise.all([
    vibeFetch('/v1/me', headers),
    vibeFetch('/v1/categories/2?limit=500&sort=sort&select=id,name,sort,isDefault', headers),
  ])
  const identity = meEnvelope.data || {}
  const categories = normalizeCategories(categoriesEnvelope.data)

  const dealParams = new URLSearchParams({
    limit: String(MAX_DEALS),
    sort: '-createdAt',
    select: 'id,title,amount,currency,stageId,categoryId,assignedById,createdAt,closed',
    withTotal: 'true',
  })
  dealParams.set('filter[>=createdAt]', `${from}T00:00:00.000Z`)
  dealParams.set('filter[<=createdAt]', `${to}T23:59:59.999Z`)
  if (selectedCategoryId !== null) dealParams.set('filter[categoryId]', String(selectedCategoryId))

  const dealsEnvelope = await vibeFetch(`/v1/deals?${dealParams}`, headers)
  const deals = Array.isArray(dealsEnvelope.data) ? dealsEnvelope.data : []
  const categoryIds = [...new Set(deals.map((deal) => Number(deal.categoryId) || 0))]

  const [usersResult, departmentsResult, ...stageResults] = await Promise.allSettled([
    vibeFetch('/v1/users?limit=5000&select=id,name,lastName,secondName,departmentId,workPosition', headers),
    vibeFetch('/v1/departments?limit=5000&select=id,name', headers),
    ...categoryIds.map((categoryId) => {
      const entityId = categoryId === 0 ? 'DEAL_STAGE' : `DEAL_STAGE_${categoryId}`
      return vibeFetch(`/v1/statuses?limit=500&sort=sort&filter[entityId]=${encodeURIComponent(entityId)}`, headers)
    }),
  ])

  const rejectedStage = stageResults.find((result) => result.status === 'rejected')
  if (rejectedStage) throw rejectedStage.reason

  const currentUser = currentUserFromRequest(identity, request.headers)
  let users = currentUser ? [currentUser] : []
  let responsibleNamesAvailable = true
  let departmentsAvailable = departmentsResult.status === 'fulfilled'
  if (usersResult.status === 'fulfilled') {
    users = Array.isArray(usersResult.value.data) ? usersResult.value.data : users
  } else if (usersResult.reason?.code === 'SCOPE_DENIED') {
    const assignedIds = [...new Set(deals.slice(0, 15).map((deal) => String(deal.assignedById || '')).filter(Boolean))]
    const fallbackUsers = await fetchBasicUsers(assignedIds)
    users = mergeUsers(users, fallbackUsers)
    responsibleNamesAvailable = fallbackUsers.length > 0
    departmentsAvailable = false
    console.warn('users_scope_unavailable', safeError(usersResult.reason))
  } else {
    throw usersResult.reason
  }

  if (departmentsResult.status === 'rejected' && departmentsResult.reason?.code !== 'SCOPE_DENIED') throw departmentsResult.reason
  const departments = departmentsResult.status === 'fulfilled' && Array.isArray(departmentsResult.value.data)
    ? departmentsResult.value.data
    : []
  users = attachDepartmentNames(users, departments)

  const stages = stageResults.flatMap((result) => Array.isArray(result.value.data) ? result.value.data : [])
  const total = Number(dealsEnvelope.meta?.total)
  const analytics = buildAnalytics(deals, stages, users, categories, { truncated: Number.isFinite(total) && total > deals.length })

  return json(response, 200, {
    ...analytics,
    period: { from, to },
    selectedCategoryId,
    categories,
    viewer: {
      name: identity.currentUser?.name || decodeHeader(request.headers['x-vibe-user-name-encoded']) || 'Сотрудник',
      portal: identity.portal?.domain || identity.portal || null,
    },
    warnings: [
      ...(!responsibleNamesAvailable ? [{ code: 'RESPONSIBLE_NAMES_UNAVAILABLE', message: 'Не удалось получить ФИО некоторых ответственных.' }] : []),
      ...(!departmentsAvailable ? [{ code: 'DEPARTMENTS_UNAVAILABLE', message: 'ФИО показаны; для вывода подразделений нужно повторно разрешить доступ к профилям сотрудников.' }] : []),
    ],
  })
}

function validateCategory(value) {
  if (value === null || value === '') return null
  if (!/^\d+$/.test(value)) throw publicError(400, 'INVALID_CATEGORY', 'Выберите корректное направление сделок.')
  return Number(value)
}

function normalizeCategories(items) {
  const categories = Array.isArray(items) ? items.map((item) => ({
    id: Number(item.id) || 0,
    name: item.name || ((Number(item.id) || 0) === 0 ? 'Общее' : `Направление #${item.id}`),
    sort: Number(item.sort) || 0,
  })) : []
  if (!categories.some((item) => item.id === 0)) categories.unshift({ id: 0, name: 'Общее', sort: 0 })
  return categories.sort((a, b) => a.sort - b.sort || a.id - b.id)
}

function currentUserFromRequest(identity, headers) {
  const id = identity.currentUser?.id || identity.currentUser?.bitrixUserId || headers['x-vibe-user-id']
  if (!id) return null
  return { id, fullName: identity.currentUser?.name || decodeHeader(headers['x-vibe-user-name-encoded']) || null }
}

async function fetchBasicUsers(ids) {
  const results = await Promise.allSettled(ids.filter((id) => id.length >= 2).map(async (id) => {
    const envelope = await vibeFetch(`/v1/infra/servers/${encodeURIComponent(VIBE_SERVER_ID)}/b24-users?search=${encodeURIComponent(id)}`, { 'X-Api-Key': VIBE_APP_KEY })
    const exact = Array.isArray(envelope.data) ? envelope.data.find((user) => String(user.id) === id) : null
    return exact ? { id: exact.id, fullName: exact.name, workPosition: exact.position } : null
  }))
  return results.flatMap((result) => result.status === 'fulfilled' && result.value ? [result.value] : [])
}

function mergeUsers(primary, fallback) {
  const users = new Map([...primary, ...fallback].map((user) => [String(user.id), user]))
  return [...users.values()]
}

function attachDepartmentNames(users, departments) {
  const names = new Map(departments.map((department) => [String(department.id), department.name]))
  return users.map((user) => {
    const ids = Array.isArray(user.departmentId) ? user.departmentId : Array.isArray(user.UF_DEPARTMENT) ? user.UF_DEPARTMENT : []
    return { ...user, departments: ids.map((id) => ({ id, name: names.get(String(id)) })).filter((item) => item.name) }
  })
}

async function vibeFetch(path, headers) {
  const upstream = await fetch(`${VIBE_API}${path}`, { headers, signal: AbortSignal.timeout(30_000) })
  const body = await upstream.json().catch(() => null)
  if (!upstream.ok || body?.success === false) {
    const error = publicError(upstream.status || 502, body?.error?.code || 'VIBE_API_ERROR', mapUpstreamMessage(upstream.status, body))
    throw error
  }
  return body || {}
}

function validatePeriod(from, to) {
  const today = new Date().toISOString().slice(0, 10)
  const defaultFrom = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)
  const datePattern = /^\d{4}-\d{2}-\d{2}$/
  const safeFrom = from || defaultFrom
  const safeTo = to || today
  if (!datePattern.test(safeFrom) || !datePattern.test(safeTo) || safeFrom > safeTo) {
    throw publicError(400, 'INVALID_PERIOD', 'Проверьте выбранный период: дата начала должна быть не позже даты окончания.')
  }
  return { from: safeFrom, to: safeTo }
}

async function serveStatic(response, pathname, headOnly) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const normalized = normalize(relative)
  if (normalized.startsWith('..') || normalize(join(PUBLIC_DIR, normalized)).startsWith(PUBLIC_DIR) === false) {
    return json(response, 404, { error: 'Not found' })
  }
  try {
    const body = await readFile(join(PUBLIC_DIR, normalized))
    response.writeHead(200, {
      'Content-Type': contentType(extname(normalized)),
      'Cache-Control': normalized === 'index.html' ? 'no-store' : 'public, max-age=3600',
      'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors https:; base-uri 'none'; form-action 'self'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(headOnly ? undefined : body)
  } catch (error) {
    if (error.code === 'ENOENT') return json(response, 404, { error: 'Not found' })
    throw error
  }
}

function extractBearer(value) {
  const match = /^Bearer\s+(vibe_session_[A-Za-z0-9._~-]+)$/.exec(String(value || ''))
  return match?.[1] || null
}

function decodeHeader(value) {
  try { return value ? decodeURIComponent(String(value)) : null } catch { return null }
}

function mapUpstreamMessage(status, body) {
  const code = body?.error?.code
  if (status === 401 || code === 'INVALID_SESSION' || code === 'TOKEN_MISSING') return 'Сессия истекла. Закройте и снова откройте приложение в Битрикс24.'
  if (status === 403) return 'Недостаточно прав для чтения CRM. Проверьте скоуп crm и права пользователя в Битрикс24.'
  if (status === 429) return 'Превышен лимит запросов. Подождите немного и обновите данные.'
  return body?.error?.message || 'Сервис Битрикс24 временно недоступен.'
}

function publicError(statusCode, code, publicMessage) {
  return Object.assign(new Error(code), { statusCode, code, publicMessage })
}

function safeError(error) {
  return { name: error.name, code: error.code, statusCode: error.statusCode, message: error.message }
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(body))
}

function contentType(extension) {
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' })[extension] || 'application/octet-stream'
}
