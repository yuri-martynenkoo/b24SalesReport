import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAnalytics } from '../src/analytics.js'

test('builds stage totals and KPIs using stage semantics', () => {
  const deals = [
    { id: 1, title: 'A', amount: 100, currency: 'RUB', stageId: 'NEW', categoryId: 0, assignedById: 7, createdAt: '2026-09-10T10:00:00Z' },
    { id: 2, title: 'B', amount: 300, currency: 'RUB', stageId: 'WON', categoryId: 0, assignedById: 7, createdAt: '2026-09-11T10:00:00Z', closed: true },
    { id: 3, title: 'C', amount: 50, currency: 'USD', stageId: 'WON', categoryId: 0, assignedById: 8, createdAt: '2026-09-12T10:00:00Z', closed: true },
    { id: 4, title: 'D', amount: 20, currency: 'USD', stageId: 'LOSE', categoryId: 0, assignedById: 8, createdAt: '2026-09-09T10:00:00Z', closed: true },
  ]
  const stages = [
    { categoryId: 0, statusId: 'NEW', name: 'Новая', semantics: null, sort: 10 },
    { categoryId: 0, statusId: 'WON', name: 'Успех', semantics: 'S', sort: 20 },
    { categoryId: 0, statusId: 'LOSE', name: 'Провал', semantics: 'F', sort: 30 },
  ]
  const users = [{ id: 7, name: 'Иван', lastName: 'Иванов', departments: [{ id: 5, name: 'Отдел продаж' }] }]
  const categories = [{ id: 0, name: 'Общее' }]
  const result = buildAnalytics(deals, stages, users, categories)

  assert.deepEqual(result.kpis.openAmounts, { RUB: 100 })
  assert.equal(result.kpis.wonCount, 2)
  assert.deepEqual(result.kpis.averageWonAmounts, { RUB: 300, USD: 50 })
  assert.equal(result.stages.find((stage) => stage.stageId === 'WON').count, 2)
  assert.equal(result.recent[0].id, 3)
  assert.equal(result.recent[0].responsibleName, 'Сотрудник #8')
  assert.equal(result.recent.find((deal) => deal.assignedById === 7).responsibleDepartment, 'Отдел продаж')
  assert.equal(result.recent[0].categoryName, 'Общее')
})
