export const DEAL_PAGE_SIZE = 500

export async function fetchAllDeals(fetchPage, { from, to, categoryId = null }) {
  const deals = []
  let afterId = null

  while (true) {
    const params = new URLSearchParams({
      limit: String(DEAL_PAGE_SIZE),
      'order[id]': 'asc',
      select: 'id,title,amount,currency,stageId,categoryId,assignedById,createdAt,closed',
      withTotal: 'false',
    })
    params.set('filter[>=createdAt]', `${from}T00:00:00.000Z`)
    params.set('filter[<=createdAt]', `${to}T23:59:59.999Z`)
    if (categoryId !== null) params.set('filter[categoryId]', String(categoryId))
    if (afterId !== null) params.set('filter[>id]', afterId)

    const page = await fetchPage(`/v1/deals?${params}`)
    if (!Array.isArray(page.data) || typeof page.meta?.hasMore !== 'boolean') {
      throw new Error('DEALS_PAGINATION_INVALID_RESPONSE')
    }
    deals.push(...page.data)
    if (!page.meta.hasMore) return deals

    const nextAfterId = String(page.meta.nextAfterId || '')
    if (!/^\d+$/.test(nextAfterId) || BigInt(nextAfterId || 0) === 0n || page.data.length === 0 ||
        (afterId !== null && BigInt(nextAfterId) <= BigInt(afterId))) {
      throw new Error('DEALS_PAGINATION_INVALID_CURSOR')
    }
    afterId = nextAfterId
  }
}

export function dealDetailUrl(portal, dealId) {
  const id = Number(dealId)
  const domain = typeof portal === 'string' ? portal : portal?.domain
  if (!Number.isSafeInteger(id) || id <= 0 || typeof domain !== 'string') return null

  try {
    const url = new URL(domain.includes('://') ? domain : `https://${domain}`)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password ||
        url.port || url.pathname !== '/' || url.search || url.hash) return null
    return `https://${url.hostname}/crm/deal/details/${id}/`
  } catch {
    return null
  }
}
