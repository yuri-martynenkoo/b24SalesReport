const OPEN_SEMANTIC = 'P'

export function amountByCurrency(items) {
  return items.reduce((totals, item) => {
    const currency = String(item.currency || 'RUB').toUpperCase()
    const amount = Number(item.amount) || 0
    totals[currency] = (totals[currency] || 0) + amount
    return totals
  }, {})
}

export function buildAnalytics(deals, stages, users, categories = [], { truncated = false } = {}) {
  const stageMap = new Map(stages.map((stage) => [stageKey(stage.categoryId, stage.statusId), stage]))
  const userMap = new Map(users.map((user) => [String(user.id), user]))
  const categoryMap = new Map(categories.map((category) => [Number(category.id) || 0, category]))

  const normalized = deals.map((deal) => {
    const stage = stageMap.get(stageKey(deal.categoryId, deal.stageId)) || {
      statusId: deal.stageId,
      name: deal.stageId,
      color: '#94A3B8',
      semantics: deal.closed ? (String(deal.stageId).includes('WON') ? 'S' : 'F') : OPEN_SEMANTIC,
      sort: 9999,
    }
    const responsible = userMap.get(String(deal.assignedById))
    const categoryId = Number(deal.categoryId) || 0
    const category = categoryMap.get(categoryId)
    return {
      ...deal,
      amount: Number(deal.amount) || 0,
      stage: {
        id: stage.statusId,
        name: stage.name || stage.statusId,
        color: normalizeColor(stage.color),
        semantics: stage.semantics || OPEN_SEMANTIC,
        sort: Number(stage.sort) || 0,
      },
      responsibleName: displayUser(responsible, deal.assignedById),
      responsibleDepartment: displayDepartment(responsible),
      categoryName: category?.name || (categoryId === 0 ? 'Общее' : `Направление #${categoryId}`),
    }
  })

  const open = normalized.filter((deal) => deal.stage.semantics !== 'S' && deal.stage.semantics !== 'F')
  const won = normalized.filter((deal) => deal.stage.semantics === 'S')
  const grouped = new Map()

  for (const deal of normalized) {
    const key = stageKey(deal.categoryId, deal.stage.id)
    if (!grouped.has(key)) {
      grouped.set(key, {
        stageId: deal.stage.id,
        categoryId: Number(deal.categoryId) || 0,
        categoryName: deal.categoryName,
        name: deal.stage.name,
        color: deal.stage.color,
        semantics: deal.stage.semantics,
        sort: deal.stage.sort,
        count: 0,
        amounts: {},
      })
    }
    const row = grouped.get(key)
    row.count += 1
    const currency = String(deal.currency || 'RUB').toUpperCase()
    row.amounts[currency] = (row.amounts[currency] || 0) + deal.amount
  }

  return {
    kpis: {
      openCount: open.length,
      openAmounts: amountByCurrency(open),
      wonCount: won.length,
      wonAmounts: amountByCurrency(won),
      averageWonAmounts: averagesByCurrency(won),
    },
    stages: [...grouped.values()].sort((a, b) => a.categoryId - b.categoryId || a.sort - b.sort),
    recent: normalized
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 15),
    totalDeals: normalized.length,
    truncated,
  }
}

export function stageKey(categoryId, stageId) {
  return `${Number(categoryId) || 0}:${String(stageId)}`
}

function averagesByCurrency(items) {
  const sums = amountByCurrency(items)
  const counts = items.reduce((result, item) => {
    const currency = String(item.currency || 'RUB').toUpperCase()
    result[currency] = (result[currency] || 0) + 1
    return result
  }, {})
  return Object.fromEntries(Object.entries(sums).map(([currency, total]) => [currency, total / counts[currency]]))
}

function displayUser(user, fallbackId) {
  if (!user) return fallbackId ? `Сотрудник #${fallbackId}` : 'Не назначен'
  const fullName = [user.name, user.lastName].filter(Boolean).join(' ').trim()
  return fullName || user.fullName || user.email || `Сотрудник #${user.id}`
}

function displayDepartment(user) {
  if (!user) return 'Подразделение недоступно'
  const included = user.department || user.departments
  if (typeof included === 'string') return included
  if (Array.isArray(included)) {
    const names = included.map((item) => typeof item === 'string' ? item : item?.name).filter(Boolean)
    if (names.length) return names.join(', ')
  }
  if (user.departmentName) return user.departmentName
  return 'Подразделение не указано'
}

function normalizeColor(color) {
  const value = String(color || '').trim()
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#94A3B8'
}
