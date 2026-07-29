import { describe, expect, it } from "vitest";
import { formatDuration, formatNumber, sparklinePath, timeAgo } from "@/lib/utils";

describe("timeAgo", () => {
  it("formats seconds", () => {
    expect(timeAgo(new Date(Date.now() - 5_000))).toBe("5s ago");
  });
  it("formats minutes", () => {
    expect(timeAgo(new Date(Date.now() - 60_000 * 3))).toBe("3m ago");
  });
  it("formats hours", () => {
    expect(timeAgo(new Date(Date.now() - 60_000 * 60 * 2))).toBe("2h ago");
  });
});

describe("formatDuration", () => {
  it("keeps ms below a second", () => {
    expect(formatDuration(420)).toBe("420ms");
  });
  it("formats seconds otherwise", () => {
    expect(formatDuration(4500)).toBe("4.5s");
  });
});

describe("formatNumber", () => {
  it("formats thousands and millions", () => {
    expect(formatNumber(17_600)).toBe("17.6k");
    expect(formatNumber(1_200_000)).toBe("1.2M");
    expect(formatNumber(120)).toBe("120");
  });
});

describe("sparklinePath", () => {
  it("returns empty path for insufficient data", () => {
    expect(sparklinePath([1])).toBe("");
  });
  it("builds an M/L path across the width", () => {
    const path = sparklinePath([1, 3, 2, 5], 90, 26, 2);
    expect(path.startsWith("M")).toBe(true);
    expect(path.split("L").length).toBe(4);
  });
});
