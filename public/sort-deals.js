const collator = new Intl.Collator('ru-RU', { numeric: true, sensitivity: 'base' })

export function sortDeals(deals, key, direction = 'asc') {
  const factor = direction === 'desc' ? -1 : 1
  return [...deals].sort((left, right) => factor * compare(left, right, key))
}

function compare(left, right, key) {
  if (key === 'createdAt') return dateValue(left.createdAt) - dateValue(right.createdAt)
  if (key === 'amount') {
    const currency = collator.compare(String(left.currency || 'RUB'), String(right.currency || 'RUB'))
    return currency || (Number(left.amount) || 0) - (Number(right.amount) || 0)
  }
  const leftValue = key === 'stage' ? left.stage?.name : left[key]
  const rightValue = key === 'stage' ? right.stage?.name : right[key]
  return collator.compare(String(leftValue || ''), String(rightValue || ''))
}

function dateValue(value) {
  const date = new Date(value).valueOf()
  return Number.isNaN(date) ? 0 : date
}
