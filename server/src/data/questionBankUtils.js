/** Helpers for catalog chapter index (server). */

export function buildChapterIndexForClass(catalog, classId) {
  const classItem = catalog.find((c) => c.id === classId);
  if (!classItem) return [];
  const index = [];
  for (const unit of classItem.units || []) {
    for (const unitChapter of unit.chapters || []) {
      index.push({
        id: unitChapter.id,
        unitId: unit.id,
        name: unitChapter.name,
        unitName: [unit.name, unit.title].filter(Boolean).join(" — "),
      });
    }
  }
  return index;
}
