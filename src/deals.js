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
