// Level ladder — display-only progression derived purely from
// rewardPointsBalance, no schema/DB state of its own. Thresholds are a
// first-draft proposal (not yet confirmed against a client spec — the
// shared developer guide covers points/stamps but never mentions levels)
// chosen so "Property Planner" lands at Level 3, matching the prototype
// screenshot ("42% to Level 3 · Property Planner"). Adjust freely; nothing
// else in the schema depends on these values.
export interface LevelDefinition {
  level: number;
  name: string;
  min: number;
}

export const LEVELS: LevelDefinition[] = [
  { level: 1, name: 'Property Novice', min: 0 },
  { level: 2, name: 'Property Explorer', min: 200 },
  { level: 3, name: 'Property Planner', min: 500 },
  { level: 4, name: 'Property Strategist', min: 1000 },
  { level: 5, name: 'Property Expert', min: 2000 },
  { level: 6, name: 'Property Master', min: 4000 },
];

export interface LevelProgress {
  level: number;
  name: string;
  min: number;
  next: { level: number; name: string; min: number } | null;
  progressPercent: number; // 0-100 toward `next`; 100 (maxed) when next is null
  pointsToNext: number; // 0 when next is null
}

export function getLevelProgress(balance: number): LevelProgress {
  let current = LEVELS[0];
  let next: LevelDefinition | null = null;
  for (let i = 0; i < LEVELS.length; i++) {
    if (balance >= LEVELS[i].min) {
      current = LEVELS[i];
      next = LEVELS[i + 1] ?? null;
    }
  }
  const progressPercent = next
    ? Math.max(0, Math.min(100, Math.round(((balance - current.min) / (next.min - current.min)) * 100)))
    : 100;
  return {
    level: current.level,
    name: current.name,
    min: current.min,
    next: next ? { level: next.level, name: next.name, min: next.min } : null,
    progressPercent,
    pointsToNext: next ? Math.max(0, next.min - balance) : 0,
  };
}
