const SUM_AMOUNT = [{ field: 'amount', function: 'sum' }]

function stageKey(categoryId, stageId) {
  return `${Number(categoryId) || 0}:${String(stageId)}`
}

export function dealFilter(from, to, categoryId = null, responsibleId = null, currency = null) {
  const filter = {
    createdAt: { $gte: `${from}T00:00:00.000Z`, $lte: `${to}T23:59:59.999Z` },
  }
  if (categoryId !== null) filter.categoryId = categoryId
  if (responsibleId !== null) filter.assignedById = responsibleId
  if (currency !== null) filter.currency = currency
  return filter
}

export function recentDealsPath(from, to, categoryId = null, responsibleId = null) {
  const params = new URLSearchParams({
    limit: '15',
    sort: '-createdAt',
    select: 'id,title,amount,currency,stageId,categoryId,assignedById,createdAt,closed',
    withTotal: 'false',
  })
  params.set('filter[>=createdAt]', `${from}T00:00:00.000Z`)
  params.set('filter[<=createdAt]', `${to}T23:59:59.999Z`)
  if (categoryId !== null) params.set('filter[categoryId]', String(categoryId))
  if (responsibleId !== null) params.set('filter[assignedById]', String(responsibleId))
  return `/v1/deals?${params}`
}

// The aggregate API processes at most 5,000 records. Split the selected period
// rather than displaying partial sums; a single over-limit day is an explicit error.
export async function aggregatePeriod(fetchAggregate, { from, to, filter, groupBy, aggregate }) {
  const query = { filter: { ...filter, createdAt: dealFilter(from, to).createdAt } }
  if (groupBy) query.groupBy = groupBy
  if (aggregate) query.aggregate = aggregate
  let data
  try {
    const envelope = await fetchAggregate(query)
    data = envelope?.data
  } catch (error) {
    if (error.code !== 'AGGREGATION_LIMIT_EXCEEDED') throw error
    return splitOrFail(fetchAggregate, { from, to, filter, groupBy, aggregate })
  }
  if (!data || !Number.isSafeInteger(data.count) || !data.meta || (groupBy && !Array.isArray(data.groups))) {
    throw reportError('AGGREGATION_INVALID_RESPONSE', 'Сервис вернул неполный ответ агрегации.')
  }
  const groupsCount = groupBy ? data.groups.reduce((total, group) => total + Number(group.count || 0), 0) : data.count
  if (data.meta.truncated || data.meta.groupsTruncated || groupsCount !== data.count) {
    return splitOrFail(fetchAggregate, { from, to, filter, groupBy, aggregate })
  }
  return { count: data.count, groups: data.groups || [] }
}

async function splitOrFail(fetchAggregate, options) {
  const start = Date.parse(`${options.from}T00:00:00Z`)
  const end = Date.parse(`${options.to}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw reportError('AGGREGATION_LIMIT_EXCEEDED', 'Не удалось точно рассчитать данные даже за один день. Выберите другой период или уточните направление и ответственного.', 422)
  }
  const mid = start + Math.floor((end - start) / 86400000 / 2) * 86400000
  const left = await aggregatePeriod(fetchAggregate, { ...options, to: new Date(mid).toISOString().slice(0, 10) })
  const right = await aggregatePeriod(fetchAggregate, { ...options, from: new Date(mid + 86400000).toISOString().slice(0, 10) })
  return mergeAggregates(left, right, options.groupBy)
}

function mergeAggregates(left, right, groupBy) {
  if (!groupBy) return { count: left.count + right.count, groups: [] }
  const fields = Array.isArray(groupBy) ? groupBy : [groupBy]
  const merged = new Map()
  for (const group of [...left.groups, ...right.groups]) {
    const key = JSON.stringify(fields.map((field) => group[field] ?? null))
    const previous = merged.get(key)
    if (!previous) {
      merged.set(key, { ...group, count: Number(group.count || 0), aggregates: { amount: { sum: Number(group.aggregates?.amount?.sum || 0) } } })
    } else {
      previous.count += Number(group.count || 0)
      previous.aggregates.amount.sum += Number(group.aggregates?.amount?.sum || 0)
    }
  }
  return { count: left.count + right.count, groups: [...merged.values()] }
}

export async function fetchReportData(fetchAggregate, fetchList, { from, to, categoryId, requestedResponsibleId, currencies }) {
  const filter = dealFilter(from, to, categoryId)
  const responsiblesResult = await aggregatePeriod(fetchAggregate, { from, to, filter, groupBy: 'assignedById' })
  const availableIds = new Set(responsiblesResult.groups.map((group) => Number(group.assignedById)).filter((id) => Number.isSafeInteger(id) && id > 0))
  const selectedResponsibleId = availableIds.has(requestedResponsibleId) ? requestedResponsibleId : null
  const selectedFilter = dealFilter(from, to, categoryId, selectedResponsibleId)
  const expected = selectedResponsibleId === null
    ? responsiblesResult.count
    : (await aggregatePeriod(fetchAggregate, { from, to, filter: selectedFilter })).count

  const stageResults = []
  for (const currency of currencies) {
    const result = await aggregatePeriod(fetchAggregate, {
      from, to, filter: dealFilter(from, to, categoryId, selectedResponsibleId, currency),
      groupBy: ['categoryId', 'stageId'], aggregate: SUM_AMOUNT,
    })
    stageResults.push({ currency, ...result })
  }
  if (stageResults.reduce((total, result) => total + result.count, 0) !== expected) {
    throw reportError('CURRENCY_TOTAL_MISMATCH', 'Не удалось сверить суммы по валютам с общим количеством сделок.')
  }
  const recentEnvelope = await fetchList(recentDealsPath(from, to, categoryId, selectedResponsibleId))
  if (!Array.isArray(recentEnvelope?.data)) throw reportError('DEALS_INVALID_RESPONSE', 'Сервис вернул неверный список сделок.')
  return { responsiblesResult, selectedResponsibleId, stageResults, recent: recentEnvelope.data, totalDeals: expected }
}

export function buildAggregatedAnalytics(report, stages, users, categories) {
  const stageMap = new Map(stages.map((stage) => [stageKey(stage.categoryId, stage.statusId), stage]))
  const userMap = new Map(users.map((user) => [String(user.id), user]))
  const categoryMap = new Map(categories.map((category) => [Number(category.id) || 0, category]))
  const nameFor = (id) => {
    const user = userMap.get(String(id))
    if (!user) return id ? `Сотрудник #${id}` : 'Не назначен'
    return [user.name, user.lastName].filter(Boolean).join(' ').trim() || user.fullName || `Сотрудник #${id}`
  }
  const departmentFor = (id) => {
    const user = userMap.get(String(id))
    if (!user) return 'Подразделение недоступно'
    const names = (user.departments || []).map((item) => item.name).filter(Boolean)
    return names.length ? names.join(', ') : 'Подразделение не указано'
  }
  const categoryName = (id) => categoryMap.get(Number(id) || 0)?.name || ((Number(id) || 0) === 0 ? 'Общее' : `Направление #${id}`)
  const grouped = new Map()
  const kpis = { openCount: 0, openAmounts: {}, wonCount: 0, wonAmounts: {}, averageWonAmounts: {} }
  for (const { currency, groups } of report.stageResults) {
    for (const group of groups) {
      const categoryId = Number(group.categoryId) || 0
      const stage = stageMap.get(stageKey(categoryId, group.stageId))
      if (!stage) throw reportError('STAGE_METADATA_MISSING', 'Не удалось получить полный справочник стадий для точного расчёта KPI.')
      const key = stageKey(categoryId, group.stageId)
      if (!grouped.has(key)) grouped.set(key, {
        stageId: group.stageId, categoryId, categoryName: categoryName(categoryId),
        name: stage.name || group.stageId, color: normalizeColor(stage.color),
        semantics: stage.semantics || 'P', sort: Number(stage.sort) || 0,
        count: 0, amounts: {},
      })
      const count = Number(group.count || 0)
      const sum = Number(group.aggregates?.amount?.sum || 0)
      const row = grouped.get(key)
      row.count += count
      row.amounts[currency] = (row.amounts[currency] || 0) + sum
      if (row.semantics === 'S') {
        kpis.wonCount += count
        kpis.wonAmounts[currency] = (kpis.wonAmounts[currency] || 0) + sum
      } else if (row.semantics !== 'F') {
        kpis.openCount += count
        kpis.openAmounts[currency] = (kpis.openAmounts[currency] || 0) + sum
      }
    }
  }
  for (const currency of Object.keys(kpis.wonAmounts)) {
    const wonCount = report.stageResults.find((item) => item.currency === currency)?.groups
      .filter((group) => (stageMap.get(stageKey(group.categoryId, group.stageId))?.semantics || 'P') === 'S')
      .reduce((total, group) => total + Number(group.count || 0), 0) || 0
    if (wonCount) kpis.averageWonAmounts[currency] = kpis.wonAmounts[currency] / wonCount
  }
  const responsibles = report.responsiblesResult.groups.flatMap((group) => {
    const id = Number(group.assignedById)
    return Number.isSafeInteger(id) && id > 0 ? [{ id, name: nameFor(id) }] : []
  }).sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.id - b.id)
  const recent = report.recent.map((deal) => {
    const stage = stageMap.get(stageKey(deal.categoryId, deal.stageId))
    return {
      ...deal, amount: Number(deal.amount) || 0,
      stage: { id: deal.stageId, name: stage?.name || deal.stageId, color: normalizeColor(stage?.color) },
      responsibleName: nameFor(deal.assignedById), responsibleDepartment: departmentFor(deal.assignedById),
      categoryName: categoryName(deal.categoryId),
    }
  })
  return {
    responsibles, selectedResponsibleId: report.selectedResponsibleId, kpis,
    stages: [...grouped.values()].sort((a, b) => a.categoryId - b.categoryId || a.sort - b.sort),
    recent, totalDeals: report.totalDeals,
  }
}

function reportError(code, publicMessage, statusCode = 502) {
  return Object.assign(new Error(code), { code, publicMessage, statusCode })
}

function normalizeColor(color) {
  const value = String(color || '').trim()
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#94A3B8'
}
