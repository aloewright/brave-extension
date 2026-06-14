import { SECTIONS, type SectionDef, type SectionId } from "../sections/types";

export function normalizeRailSectionOrder(
  storedOrder: readonly string[] | undefined,
  sections: readonly SectionDef[] = SECTIONS,
): SectionId[] {
  const validIds = new Set(sections.map((section) => section.id));
  const ordered: SectionId[] = [];
  const seen = new Set<SectionId>();

  for (const id of storedOrder ?? []) {
    if (!validIds.has(id as SectionId)) continue;
    const sectionId = id as SectionId;
    if (seen.has(sectionId)) continue;
    ordered.push(sectionId);
    seen.add(sectionId);
  }

  for (const section of sections) {
    if (seen.has(section.id)) continue;
    ordered.push(section.id);
    seen.add(section.id);
  }

  return ordered;
}

export function moveRailSection(
  currentOrder: readonly SectionId[],
  draggedId: SectionId,
  targetId: SectionId,
): SectionId[] {
  if (draggedId === targetId) return [...currentOrder];

  const next = currentOrder.filter((id) => id !== draggedId);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex === -1) return [...currentOrder];

  next.splice(targetIndex, 0, draggedId);
  return next;
}
