const DEFAULT_MATERIAL_CATEGORY = "Syllabus";

export function normalizeMaterialCategory(file) {
  const raw = file.materialCategory || DEFAULT_MATERIAL_CATEGORY;
  return raw === "Others" ? "Syllabus" : raw;
}
