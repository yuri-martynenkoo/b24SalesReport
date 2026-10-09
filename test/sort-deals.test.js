import test from 'node:test'
import assert from 'node:assert/strict'
import { sortDeals } from '../public/sort-deals.js'

test('sorts the recent-deal sample without changing which deals are in it', () => {
  const deals = [
    { id: 1, title: 'Сделка 10', amount: 500, currency: 'RUB', createdAt: '2026-10-08T09:00:00Z', stage: { name: 'Новая' } },
    { id: 2, title: 'Сделка 2', amount: 100, currency: 'RUB', createdAt: '2026-10-09T09:00:00Z', stage: { name: 'Успех' } },
    { id: 3, title: 'Сделка 3', amount: 20, currency: 'USD', createdAt: '2026-10-07T09:00:00Z', stage: { name: 'Новая' } },
  ]

  assert.deepEqual(sortDeals(deals, 'createdAt', 'desc').map((deal) => deal.id), [2, 1, 3])
  assert.deepEqual(sortDeals(deals, 'title', 'asc').map((deal) => deal.id), [2, 3, 1])
  assert.deepEqual(sortDeals(deals, 'amount', 'asc').map((deal) => deal.id), [2, 1, 3])
  assert.deepEqual(deals.map((deal) => deal.id), [1, 2, 3])
})
