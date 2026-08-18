export type RefereeSeed = { id: string; name?: string };
export type RefereeMatch = {
  id: string;
  startTime: string;
  fieldIdx?: number;
  homeTeamId: string;
  awayTeamId: string;
};

export type RefereeAssignmentResult = {
  assignments: Record<string, string>;
  unassignedMatchIds: string[];
  repeatedTeamRelaxations: number;
  consecutiveSlotRelaxations: number;
};

function timeKey(value: string) {
  return String(value ?? "").slice(0, 5);
}

/**
 * Affectation automatique équilibrée.
 * Priorités:
 * 1. jamais deux matchs au même horaire pour le même arbitre;
 * 2. éviter qu'un arbitre retrouve une équipe lors de deux affectations successives;
 * 3. laisser au moins un créneau de repos entre deux affectations si possible;
 * 4. équilibrer le nombre total de matchs.
 *
 * Si une contrainte 2 ou 3 est mathématiquement impossible avec les arbitres disponibles,
 * l'algorithme la relâche en la pénalisant fortement plutôt que de bloquer tout le planning.
 */
export function assignReferees(referees: RefereeSeed[], matches: RefereeMatch[]): RefereeAssignmentResult {
  const ordered = [...matches].sort((a, b) => {
    const t = timeKey(a.startTime).localeCompare(timeKey(b.startTime));
    if (t !== 0) return t;
    return Number(a.fieldIdx ?? 0) - Number(b.fieldIdx ?? 0);
  });

  const times = [...new Set(ordered.map((m) => timeKey(m.startTime)))];
  const slotIndex = new Map<string, number>(times.map((t, i) => [t, i]));
  const counts = new Map<string, number>(referees.map((r) => [r.id, 0]));
  const lastSlot = new Map<string, number>();
  const lastTeams = new Map<string, Set<string>>();
  const usedAtTime = new Map<string, Set<string>>();
  const assignments: Record<string, string> = {};
  const unassignedMatchIds: string[] = [];
  let repeatedTeamRelaxations = 0;
  let consecutiveSlotRelaxations = 0;

  for (const m of ordered) {
    const time = timeKey(m.startTime);
    const slot = slotIndex.get(time) ?? 0;
    if (!usedAtTime.has(time)) usedAtTime.set(time, new Set());
    const busy = usedAtTime.get(time)!;

    const available = referees.filter((ref) => !busy.has(ref.id));
    if (!available.length) {
      unassignedMatchIds.push(m.id);
      continue;
    }

    const noRepeatedTeam = available.filter((ref) => {
      const lt = lastTeams.get(ref.id);
      return !(lt?.has(m.homeTeamId) || lt?.has(m.awayTeamId));
    });
    const teamRuleRelaxed = noRepeatedTeam.length === 0;
    const teamCandidates = teamRuleRelaxed ? available : noRepeatedTeam;

    const withRest = teamCandidates.filter((ref) => {
      const ls = lastSlot.get(ref.id);
      return ls == null || slot - ls > 1;
    });
    const restRuleRelaxed = withRest.length === 0;
    const candidates = restRuleRelaxed ? teamCandidates : withRest;

    let best: RefereeSeed | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const ref of candidates) {
      const score = counts.get(ref.id) ?? 0;
      if (score < bestScore) {
        bestScore = score;
        best = ref;
      }
    }
    if (!best) {
      unassignedMatchIds.push(m.id);
      continue;
    }

    if (teamRuleRelaxed) repeatedTeamRelaxations += 1;
    if (restRuleRelaxed && lastSlot.has(best.id)) consecutiveSlotRelaxations += 1;

    assignments[m.id] = best.id;
    busy.add(best.id);
    counts.set(best.id, (counts.get(best.id) ?? 0) + 1);
    lastSlot.set(best.id, slot);
    lastTeams.set(best.id, new Set([m.homeTeamId, m.awayTeamId]));
  }

  return { assignments, unassignedMatchIds, repeatedTeamRelaxations, consecutiveSlotRelaxations };
}
