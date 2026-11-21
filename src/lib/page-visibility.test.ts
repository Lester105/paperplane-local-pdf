import { describe, expect, it } from "vitest";
import { findMostVisiblePage } from "./page-visibility";

describe("findMostVisiblePage", () => {
  it("chooses the page with the largest visible portion", () => {
    expect(findMostVisiblePage([
      { id: "page-1", top: -100, bottom: 400 },
      { id: "page-2", top: 350, bottom: 850 },
    ], 0, 500)).toBe("page-1");
  });

  it("uses viewport-center distance to break visibility ties", () => {
    expect(findMostVisiblePage([
      { id: "page-1", top: 100, bottom: 300 },
      { id: "page-2", top: -100, bottom: 600 },
    ], 0, 500)).toBe("page-2");
  });

  it("returns null when no page intersects the viewport", () => {
    expect(findMostVisiblePage([{ id: "page-1", top: 700, bottom: 1200 }], 0, 500)).toBeNull();
  });
});
