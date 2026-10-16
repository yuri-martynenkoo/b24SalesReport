export function groupStagesByCategory(stages) {
  const groups = new Map()
  for (const stage of stages || []) {
    const categoryId = Number(stage.categoryId) || 0
    if (!groups.has(categoryId)) {
      groups.set(categoryId, {
        categoryId,
        categoryName: stage.categoryName || (categoryId === 0 ? 'Общее' : `Направление #${categoryId}`),
        stages: [],
      })
    }
    groups.get(categoryId).stages.push(stage)
  }
  return [...groups.values()]
}
