import type { NullableNumber } from "../types";

export interface StorageClass {
  min: number;
  label: string;
  color: string;
}

export const STORAGE_CLASSES: readonly StorageClass[] = [
  { min: 0, label: "Under 25%", color: "#d73027" },
  { min: 25, label: "25–49%", color: "#fc8d59" },
  { min: 50, label: "50–74%", color: "#fee08b" },
  { min: 75, label: "75–89%", color: "#91cf60" },
  { min: 90, label: "90% or more", color: "#1a9850" }
] as const;

export function storageClass(percent: NullableNumber): StorageClass | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  for (let index = STORAGE_CLASSES.length - 1; index >= 0; index -= 1) {
    const candidate = STORAGE_CLASSES[index];
    if (candidate && percent >= candidate.min) return candidate;
  }
  return STORAGE_CLASSES[0] ?? null;
}
