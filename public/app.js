const elements = Object.fromEntries([...document.querySelectorAll('[id]')].map((element) => [element.id, element]))
const formatters = new Map()

initializePeriod(30)
loadDashboard()

elements['period-form'].addEventListener('submit', (event) => {
  event.preventDefault()
  document.querySelectorAll('.preset').forEach((button) => button.classList.remove('active'))
  loadDashboard()
})
elements.refresh.addEventListener('click', loadDashboard)
elements.retry.addEventListener('click', loadDashboard)
document.querySelectorAll('.preset').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.preset').forEach((item) => item.classList.toggle('active', item === button))
  if (button.dataset.period === 'quarter') initializeQuarter()
  else initializePeriod(Number(button.dataset.days))
  loadDashboard()
}))

async function loadDashboard() {
  const from = elements.from.value
  const to = elements.to.value
  if (!from || !to || from > to) {
    showError('Дата начала должна быть не позже даты окончания.')
    return
  }

  setLoading(true)
  try {
    const category = elements.category.value
    const query = new URLSearchParams({ from, to })
    if (category !== '') query.set('categoryId', category)
    const response = await fetch(`/api/dashboard?${query}`, { credentials: 'same-origin' })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(errorMessage(body))
    render(body)
  } catch (error) {
    showError(error.message)
  } finally {
    setLoading(false)
  }
}

function render(data) {
  elements.error.classList.add('hidden')
  elements.content.classList.remove('hidden')
  elements.viewer.textContent = [data.viewer?.name, data.viewer?.portal].filter(Boolean).join(' · ') || 'Данные в рамках ваших прав доступа'
  elements['open-amount'].textContent = formatAmounts(data.kpis.openAmounts)
  elements['open-count'].textContent = plural(data.kpis.openCount, 'открытая сделка', 'открытые сделки', 'открытых сделок')
  elements['won-count'].textContent = new Intl.NumberFormat('ru-RU').format(data.kpis.wonCount)
  elements['won-amount'].textContent = formatAmounts(data.kpis.wonAmounts)
  elements['average-amount'].textContent = formatAmounts(data.kpis.averageWonAmounts)
  elements['deal-total'].textContent = plural(data.totalDeals, 'сделка', 'сделки', 'сделок')
  renderCategoryOptions(data.categories, data.selectedCategoryId)

  elements.stages.replaceChildren(...data.stages.map(stageRow))
  elements.recent.replaceChildren(...data.recent.map(dealRow))
  elements.empty.classList.toggle('hidden', data.recent.length > 0)
  const warning = Array.isArray(data.warnings) ? data.warnings.find((item) => item?.message) : null
  elements['status'].textContent = warning?.message || (data.truncated
    ? 'Показаны первые 5 000 сделок. Сузьте период для точного итога.'
    : `Данные обновлены ${new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`)
  notifyFrameHeight()
}

function errorMessage(body) {
  if (typeof body?.error === 'string') return body.error
  if (typeof body?.error?.message === 'string') return body.error.message
  if (typeof body?.message === 'string') return body.message
  if (typeof body?.error?.code === 'string') return `Ошибка сервиса: ${body.error.code}`
  return 'Неизвестная ошибка. Попробуйте обновить данные.'
}

function stageRow(stage) {
  const row = document.createElement('article')
  row.className = 'stage-row'
  row.innerHTML = `<span class="stage-dot"></span><div class="stage-main"><strong></strong><span></span></div><div class="stage-metric"><strong></strong><span></span></div>`
  row.querySelector('.stage-dot').style.background = stage.color
  row.querySelector('.stage-main strong').textContent = stage.name
  row.querySelector('.stage-main span').textContent = `${stage.categoryName} · stageId: ${stage.stageId}`
  row.querySelector('.stage-metric strong').textContent = formatAmounts(stage.amounts)
  row.querySelector('.stage-metric span').textContent = plural(stage.count, 'сделка', 'сделки', 'сделок')
  return row
}

function dealRow(deal) {
  const row = document.createElement('tr')
  const title = cell('deal-title', deal.title || `Сделка #${deal.id}`)
  const amount = cell('', formatMoney(deal.amount, deal.currency))
  const stageCell = document.createElement('td')
  const stage = document.createElement('span')
  stage.className = 'stage-chip'
  stage.style.setProperty('--stage-color', deal.stage.color)
  stage.textContent = deal.stage.name
  stage.title = `stageId: ${deal.stage.id}`
  stageCell.append(stage)
  const responsible = document.createElement('td')
  responsible.className = 'person-cell'
  const personName = document.createElement('strong')
  personName.textContent = deal.responsibleName
  const department = document.createElement('span')
  department.textContent = deal.responsibleDepartment
  responsible.append(personName, department)
  row.append(title, amount, cell('', deal.categoryName), stageCell, responsible, cell('', formatDate(deal.createdAt)))
  return row
}

function renderCategoryOptions(categories, selectedCategoryId) {
  const selected = selectedCategoryId === null || selectedCategoryId === undefined ? '' : String(selectedCategoryId)
  const options = [option('', 'Все направления'), ...(categories || []).map((category) => option(String(category.id), category.name))]
  elements.category.replaceChildren(...options)
  elements.category.value = selected
}

function option(value, label) {
  const item = document.createElement('option')
  item.value = value
  item.textContent = label
  return item
}

function cell(className, text) {
  const item = document.createElement('td')
  item.className = className
  item.textContent = text
  item.title = text
  return item
}

function formatAmounts(amounts) {
  const values = Object.entries(amounts || {})
  if (!values.length) return '0 ₽'
  return values.map(([currency, amount]) => formatMoney(amount, currency)).join(' · ')
}

function formatMoney(amount, currency = 'RUB') {
  const key = String(currency || 'RUB').toUpperCase()
  if (!formatters.has(key)) {
    try { formatters.set(key, new Intl.NumberFormat('ru-RU', { style: 'currency', currency: key, maximumFractionDigits: 0 })) }
    catch { formatters.set(key, new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })) }
  }
  return formatters.get(key).format(Number(amount) || 0)
}

function formatDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(date)
}

function plural(value, one, few, many) {
  const number = Math.abs(Number(value))
  const mod100 = number % 100
  const mod10 = number % 10
  const word = mod100 >= 11 && mod100 <= 19 ? many : mod10 === 1 ? one : mod10 >= 2 && mod10 <= 4 ? few : many
  return `${new Intl.NumberFormat('ru-RU').format(number)} ${word}`
}

function initializePeriod(days) {
  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - days + 1)
  elements.from.value = localDate(from)
  elements.to.value = localDate(to)
}

function initializeQuarter() {
  const to = new Date()
  const from = new Date(to.getFullYear(), Math.floor(to.getMonth() / 3) * 3, 1)
  elements.from.value = localDate(from)
  elements.to.value = localDate(to)
}

function localDate(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

function setLoading(loading) {
  elements.refresh.disabled = loading
  elements.refresh.classList.toggle('spinning', loading)
  if (loading) {
    elements.status.textContent = 'Загружаем аналитику…'
    elements.error.classList.add('hidden')
  }
}

function showError(message) {
  elements.content.classList.add('hidden')
  elements.error.classList.remove('hidden')
  elements['error-message'].textContent = message
  elements.status.textContent = ''
  notifyFrameHeight()
}

function notifyFrameHeight() {
  if (window.parent === window) return
  requestAnimationFrame(() => window.parent.postMessage({ type: 'vibe:resize', height: document.documentElement.scrollHeight }, '*'))
}

new ResizeObserver(notifyFrameHeight).observe(document.body)
