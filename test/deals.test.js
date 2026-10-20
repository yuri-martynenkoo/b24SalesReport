import test from 'node:test'
import assert from 'node:assert/strict'
import { dealDetailUrl } from '../src/deals.js'

test('builds a deal-card URL on the authorized portal only', () => {
  assert.equal(dealDetailUrl({ domain: 'asiaformula.bitrix24.ru' }, 741),
    'https://asiaformula.bitrix24.ru/crm/deal/details/741/')
  assert.equal(dealDetailUrl('https://crm.example.ru', '42'),
    'https://crm.example.ru/crm/deal/details/42/')
  assert.equal(dealDetailUrl('http://crm.example.ru', 42), null)
  assert.equal(dealDetailUrl('https://crm.example.ru/other', 42), null)
  assert.equal(dealDetailUrl('crm.example.ru', 'bad-id'), null)
})
