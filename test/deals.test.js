import test from 'node:test'
import assert from 'node:assert/strict'
import { DEAL_PAGE_SIZE, dealDetailUrl, fetchAllDeals } from '../src/deals.js'

test('loads more than 5,000 deals with an ascending ID cursor', async () => {
  const source = Array.from({ length: 5_201 }, (_, index) => ({ id: index + 1 }))
  const requests = []
  const deals = await fetchAllDeals(async (path) => {
    const params = new URL(path, 'https://example.test').searchParams
    requests.push(params)
    const afterId = Number(params.get('filter[>id]') || 0)
    const page = source.filter((deal) => deal.id > afterId).slice(0, DEAL_PAGE_SIZE)
    return {
      data: page,
      meta: { hasMore: afterId + page.length < source.length, nextAfterId: String(page.at(-1)?.id || '') },
    }
  }, { from: '2026-10-01', to: '2026-10-11', categoryId: 20 })

  assert.equal(deals.length, 5_201)
  assert.deepEqual(deals.map((deal) => deal.id), source.map((deal) => deal.id))
  assert.equal(requests.length, 11)
  assert.equal(requests[0].get('order[id]'), 'asc')
  assert.equal(requests[0].get('filter[categoryId]'), '20')
  assert.equal(requests[0].get('filter[>=createdAt]'), '2026-10-01T00:00:00.000Z')
  assert.equal(requests[1].get('filter[>id]'), '500')
})

test('rejects an invalid pagination cursor instead of returning partial totals', async () => {
  await assert.rejects(
    fetchAllDeals(async () => ({ data: [{ id: 1 }], meta: { hasMore: true, nextAfterId: '0' } }),
      { from: '2026-10-01', to: '2026-10-11' }),
    /DEALS_PAGINATION_INVALID_CURSOR/,
  )
})

test('builds a deal-card URL on the authorized portal only', () => {
  assert.equal(dealDetailUrl({ domain: 'asiaformula.bitrix24.ru' }, 741),
    'https://asiaformula.bitrix24.ru/crm/deal/details/741/')
  assert.equal(dealDetailUrl('https://crm.example.ru', '42'),
    'https://crm.example.ru/crm/deal/details/42/')
  assert.equal(dealDetailUrl('http://crm.example.ru', 42), null)
  assert.equal(dealDetailUrl('https://crm.example.ru/other', 42), null)
  assert.equal(dealDetailUrl('crm.example.ru', 'bad-id'), null)
})
