export type Pair = { a: string; b: string; round?: number; groupIdx?: number };
export type NamedTeam = { id: string; name: string };

export function normalizeTeamName(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function editDistance(a: string, b: string) {
  const x = normalizeTeamName(a), y = normalizeTeamName(b);
  const row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (x[i - 1] === y[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[y.length];
}

export function prioritizeSimilarFirstMatches(pairs: Pair[], teams: NamedTeam[], threshold = 2) {
  const names = new Map(teams.map(team => [team.id, team.name]));
  const candidates = pairs
    .map((pair, index) => ({ pair, index, distance: editDistance(names.get(pair.a) ?? "", names.get(pair.b) ?? "") }))
    .filter(item => item.distance <= threshold)
    .sort((a, b) => a.distance - b.distance || a.index - b.index);
  const used = new Set<string>(); const forced: Pair[] = [];
  for (const item of candidates) {
    if (used.has(item.pair.a) || used.has(item.pair.b)) continue;
    used.add(item.pair.a); used.add(item.pair.b); forced.push(item.pair);
  }
  const forcedKeys = new Set(forced.map(pair => `${pair.a}|${pair.b}`));
  return [...forced, ...pairs.filter(pair => !forcedKeys.has(`${pair.a}|${pair.b}`))];
}

export function buildKnockoutPlaceholders(teamCount: number, firstMatchNumber = 1) {
  let size = 1; while (size < Math.max(2, teamCount)) size *= 2;
  const rounds = Math.log2(size); const output: Array<{ matchNumber: number; roundLabel: string; homeSource: string; awaySource: string }> = [];
  let matchNumber = firstMatchNumber; let previousRound: number[] = [];
  for (let round = 0; round < rounds; round++) {
    const count = size / 2 ** (round + 1); const current: number[] = [];
    const label = count === 1 ? "Finale" : count === 2 ? "Demi-finale" : count === 4 ? "Quart de finale" : `Tour ${round + 1}`;
    for (let i = 0; i < count; i++) {
      const number = matchNumber++; current.push(number);
      output.push({ matchNumber: number, roundLabel: label, homeSource: round === 0 ? `Qualifié ${i * 2 + 1}` : `Vainqueur M${previousRound[i * 2]}`, awaySource: round === 0 ? `Qualifié ${i * 2 + 2}` : `Vainqueur M${previousRound[i * 2 + 1]}` });
    }
    previousRound = current;
  }
  return output;
}

export function chooseRestedReferee(teamIds: string[], playing: Set<string>, lastSlot: Map<string, number>, slotIndex: number, minimumRestSlots = 1) {
  const eligible = teamIds.filter(id => !playing.has(id));
  eligible.sort((a, b) => (lastSlot.get(a) ?? -9999) - (lastSlot.get(b) ?? -9999));
  return eligible.find(id => slotIndex - (lastSlot.get(id) ?? -9999) > minimumRestSlots) ?? eligible[0] ?? null;
}
