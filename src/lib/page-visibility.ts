export interface PageViewportBounds {
  id: string;
  top: number;
  bottom: number;
}

export function findMostVisiblePage(
  pages: readonly PageViewportBounds[],
  viewportTop: number,
  viewportBottom: number,
): string | null {
  const viewportHeight = viewportBottom - viewportTop;
  if (viewportHeight <= 0) return null;

  const viewportCenter = (viewportTop + viewportBottom) / 2;
  let bestPageId: string | null = null;
  let bestRatio = 0;
  let bestCenterDistance = Number.POSITIVE_INFINITY;

  for (const page of pages) {
    const pageHeight = page.bottom - page.top;
    if (pageHeight <= 0) continue;

    const visibleTop = Math.max(page.top, viewportTop);
    const visibleBottom = Math.min(page.bottom, viewportBottom);
    const visibleHeight = visibleBottom - visibleTop;
    if (visibleHeight <= 0) continue;

    const visibleRatio = visibleHeight / Math.min(pageHeight, viewportHeight);
    const visibleCenter = (visibleTop + visibleBottom) / 2;
    const centerDistance = Math.abs(visibleCenter - viewportCenter);
    if (visibleRatio > bestRatio || (visibleRatio === bestRatio && centerDistance < bestCenterDistance)) {
      bestPageId = page.id;
      bestRatio = visibleRatio;
      bestCenterDistance = centerDistance;
    }
  }

  return bestPageId;
}
