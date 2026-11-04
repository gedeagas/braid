// Bounds for the experimental idle agent hibernation setting.

export const DEFAULT_HIBERNATION_MINUTES = 30

export function clampHibernationMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_HIBERNATION_MINUTES
  return Math.min(1440, Math.max(1, Math.round(minutes)))
}
