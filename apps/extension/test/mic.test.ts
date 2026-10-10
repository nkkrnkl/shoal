import { describe, expect, it } from "vitest";
import { rmsLevel } from "../lib/mic";

describe("rmsLevel", () => {
  it("is 0 for silence and grows with loudness, capped at 1", () => {
    expect(rmsLevel(new Float32Array(0))).toBe(0);
    expect(rmsLevel(new Float32Array(128))).toBe(0);
    const quiet = rmsLevel(new Float32Array(128).fill(0.02));
    const loud = rmsLevel(new Float32Array(128).fill(0.15));
    expect(quiet).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(quiet);
    expect(rmsLevel(new Float32Array(128).fill(1))).toBe(1);
  });
});
