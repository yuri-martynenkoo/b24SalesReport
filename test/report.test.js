import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregatePeriod, buildAggregatedAnalytics, fetchReportData, recentDealsPath } from '../src/report.js'

test('recent deal request is limited, sorted, and respects all filters', () => {
  const params = new URL(recentDealsPath('2026-10-01', '2026-10-11', 20, 7), 'https://example.test').searchParams
  assert.equal(params.get('limit'), '15')
  assert.equal(params.get('sort'), '-createdAt')
  assert.equal(params.get('filter[categoryId]'), '20')
  assert.equal(params.get('filter[assignedById]'), '7')
  assert.equal(params.get('filter[>=createdAt]'), '2026-10-01T00:00:00.000Z')
})

test('truncated aggregate splits the period and never uses partial sums', async () => {
  const requests = []
  const result = await aggregatePeriod(async (body) => {
    requests.push(body)
    if (body.filter.createdAt.$gte.startsWith('2026-10-01') && body.filter.createdAt.$lte.startsWith('2026-10-02')) {
      return { data: { count: 5201, groups: [{ stageId: 'NEW', count: 5000, aggregates: { amount: { sum: 5000 } } }], meta: { truncated: true } } }
    }
    const day = body.filter.createdAt.$gte.slice(0, 10)
    return { data: { count: day === '2026-10-01' ? 3000 : 2201, groups: [{ stageId: 'NEW', count: day === '2026-10-01' ? 3000 : 2201, aggregates: { amount: { sum: day === '2026-10-01' ? 3000 : 2201 } } }], meta: { truncated: false } } }
  }, { from: '2026-10-01', to: '2026-10-02', filter: {}, groupBy: 'stageId', aggregate: [{ field: 'amount', function: 'sum' }] })
  assert.equal(requests.length, 3)
  assert.equal(result.count, 5201)
  assert.equal(result.groups[0].aggregates.amount.sum, 5201)
})

test('422 aggregate error splits by date, but fails clearly for one over-limit day', async () => {
  await assert.rejects(
    aggregatePeriod(async () => { throw Object.assign(new Error('limit'), { code: 'AGGREGATION_LIMIT_EXCEEDED' }) },
      { from: '2026-10-01', to: '2026-10-02', filter: {}, groupBy: 'stageId' }),
    (error) => error.code === 'AGGREGATION_LIMIT_EXCEEDED' && error.statusCode === 422,
  )
})

test('report gets responsible choices from aggregate and only 15 recent deals from list', async () => {
  const requests = []
  const report = await fetchReportData(async (body) => {
    requests.push(body)
    if (body.groupBy === 'assignedById') return { data: { count: 2, groups: [{ assignedById: 7, count: 1 }, { assignedById: 8, count: 1 }], meta: { truncated: false } } }
    return { data: { count: 1, groups: [{ categoryId: 20, stageId: 'C20:WON', count: 1, aggregates: { amount: { sum: 100 } } }], meta: { truncated: false } } }
  }, async (path) => {
    assert.equal(new URL(path, 'https://example.test').searchParams.get('limit'), '15')
    return { data: [{ id: 1, title: 'A', amount: 100, currency: 'RUB', categoryId: 20, stageId: 'C20:WON', assignedById: 7 }] }
  }, { from: '2026-10-01', to: '2026-10-01', categoryId: 20, requestedResponsibleId: 7, currencies: ['RUB'] })
  assert.equal(report.selectedResponsibleId, 7)
  assert.equal(report.totalDeals, 1)
  assert.equal(requests.length, 3)
  assert.equal(requests[2].filter.currency, 'RUB')
  const analytics = buildAggregatedAnalytics(report,
    [{ categoryId: 20, statusId: 'C20:WON', name: 'Успех', semantics: 'S', sort: 1 }],
    [{ id: 7, name: 'Иван', lastName: 'Иванов', departments: [{ name: 'Продажи' }] }],
    [{ id: 20, name: 'Авто' }])
  assert.equal(analytics.kpis.wonCount, 1)
  assert.deepEqual(analytics.kpis.wonAmounts, { RUB: 100 })
  assert.equal(analytics.recent[0].responsibleDepartment, 'Продажи')
  assert.deepEqual(analytics.responsibles.map((item) => item.id), [7, 8])
})

test('KPI and stage sums remain separated by currency and stage semantics', () => {
  const report = {
    responsiblesResult: { groups: [] }, selectedResponsibleId: null, totalDeals: 4, recent: [],
    stageResults: [
      { currency: 'RUB', groups: [
        { categoryId: 0, stageId: 'NEW', count: 1, aggregates: { amount: { sum: 100 } } },
        { categoryId: 0, stageId: 'WON', count: 2, aggregates: { amount: { sum: 300 } } },
      ] },
      { currency: 'USD', groups: [
        { categoryId: 0, stageId: 'WON', count: 1, aggregates: { amount: { sum: 50 } } },
      ] },
    ],
  }
  const result = buildAggregatedAnalytics(report, [
    { categoryId: 0, statusId: 'NEW', name: 'Новая', semantics: 'P' },
    { categoryId: 0, statusId: 'WON', name: 'Успех', semantics: 'S' },
  ], [], [{ id: 0, name: 'Общее' }])
  assert.deepEqual(result.kpis.openAmounts, { RUB: 100 })
  assert.equal(result.kpis.wonCount, 3)
  assert.deepEqual(result.kpis.wonAmounts, { RUB: 300, USD: 50 })
  assert.deepEqual(result.kpis.averageWonAmounts, { RUB: 150, USD: 50 })
  assert.deepEqual(result.stages.find((stage) => stage.stageId === 'WON').amounts, { RUB: 300, USD: 50 })
})
