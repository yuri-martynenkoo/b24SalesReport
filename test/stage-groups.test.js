import test from 'node:test'
import assert from 'node:assert/strict'
import { groupStagesByCategory } from '../public/stage-groups.js'

test('groups stages by direction without changing stage order', () => {
  const stages = [
    { categoryId: 20, categoryName: 'Авто', stageId: 'NEW' },
    { categoryId: 30, categoryName: 'Услуги', stageId: 'NEW' },
    { categoryId: 20, categoryName: 'Авто', stageId: 'WON' },
  ]
  const groups = groupStagesByCategory(stages)

  assert.deepEqual(groups.map((group) => group.categoryName), ['Авто', 'Услуги'])
  assert.deepEqual(groups[0].stages.map((stage) => stage.stageId), ['NEW', 'WON'])
  assert.equal(groups[1].stages[0].stageId, 'NEW')
  assert.deepEqual(groupStagesByCategory([]), [])
})
