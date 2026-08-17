export const CLIPET_FORMAT = "michel_clipet";

export type ClipetTeam = {
  id: string;
  name: string | null;
  club_name?: string | null;
  squad_number?: number | null;
  challenge_disqualified?: boolean | null;
};

export type ClipetMatch = {
  id?: string;
  match_number?: number | null;
  phase?: string | null;
  stage?: string | null;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  status: string;
  penalty_home?: number | null;
  penalty_away?: number | null;
  winner_team_id?: string | null;
};

export type ClipetStanding = {
  team_id: string;
  team_name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  result_points: number;
  bonus_points: number;
  pts: number;
};

export function isPlayed(m: ClipetMatch) {
  return String(m.status ?? "").toLowerCase() === "played";
}

export function computeClipetStandings(teams: ClipetTeam[], matches: ClipetMatch[]) {
  const map = new Map<string, ClipetStanding>();
  for (const t of teams) {
    map.set(t.id, {
      team_id: t.id,
      team_name: (t.name ?? "Équipe").trim() || "Équipe",
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      gf: 0,
      ga: 0,
      result_points: 0,
      bonus_points: 0,
      pts: 0,
    });
  }

  for (const m of matches) {
    if (!isPlayed(m) || m.home_score == null || m.away_score == null) continue;
    const h = map.get(m.home_team_id);
    const a = map.get(m.away_team_id);
    if (!h || !a) continue;

    h.played += 1;
    a.played += 1;
    h.gf += m.home_score;
    h.ga += m.away_score;
    a.gf += m.away_score;
    a.ga += m.home_score;

    h.bonus_points += m.home_score;
    a.bonus_points += m.away_score;

    if (m.home_score > m.away_score) {
      h.wins += 1;
      a.losses += 1;
      h.result_points += 8;
      a.result_points += 2;
    } else if (m.home_score < m.away_score) {
      a.wins += 1;
      h.losses += 1;
      a.result_points += 8;
      h.result_points += 2;
    } else {
      h.draws += 1;
      a.draws += 1;
      h.result_points += 4;
      a.result_points += 4;
    }
  }

  const rows = Array.from(map.values()).map((r) => ({ ...r, pts: r.result_points + r.bonus_points }));
  rows.sort((x, y) => {
    if (y.pts !== x.pts) return y.pts - x.pts;
    if (y.gf !== x.gf) return y.gf - x.gf;
    if (x.ga !== y.ga) return x.ga - y.ga;
    return x.team_name.localeCompare(y.team_name, "fr"); // fallback stable; règlement prévoit tirage au sort manuel
  });
  return rows;
}

export function winnerOfMatch(m: ClipetMatch): string | null {
  if (!isPlayed(m) || m.home_score == null || m.away_score == null) return null;
  if (m.home_score > m.away_score) return m.home_team_id;
  if (m.away_score > m.home_score) return m.away_team_id;
  if (m.winner_team_id) return m.winner_team_id;
  const ph = Number(m.penalty_home ?? -1);
  const pa = Number(m.penalty_away ?? -1);
  if (ph >= 0 && pa >= 0 && ph !== pa) return ph > pa ? m.home_team_id : m.away_team_id;
  return null;
}

export function loserOfMatch(m: ClipetMatch): string | null {
  const w = winnerOfMatch(m);
  if (!w) return null;
  return w === m.home_team_id ? m.away_team_id : m.home_team_id;
}

export function phase1Matches(matches: ClipetMatch[]) {
  return matches.filter((m) => Number(m.match_number ?? 0) >= 1 && Number(m.match_number ?? 0) <= 45);
}

export function makePhase2Seeds(standing: ClipetStanding[]) {
  if (standing.length !== 10) throw new Error("Le format Michel Clipet exige exactement 10 équipes.");
  const id = (rank: number) => standing[rank - 1].team_id;
  return [
    { match_number: 46, stage: "semi", home_team_id: id(1), away_team_id: id(4) },
    { match_number: 47, stage: "semi", home_team_id: id(2), away_team_id: id(3) },
    { match_number: 48, stage: "places_5_7", home_team_id: id(5), away_team_id: id(6) },
    { match_number: 49, stage: "places_5_7", home_team_id: id(7), away_team_id: id(5) },
    { match_number: 50, stage: "places_5_7", home_team_id: id(6), away_team_id: id(7) },
    { match_number: 51, stage: "places_8_10", home_team_id: id(8), away_team_id: id(9) },
    { match_number: 52, stage: "places_8_10", home_team_id: id(10), away_team_id: id(8) },
    { match_number: 53, stage: "places_8_10", home_team_id: id(9), away_team_id: id(10) },
  ];
}

export function makeFinalSeeds(m46: ClipetMatch, m47: ClipetMatch) {
  const w46 = winnerOfMatch(m46);
  const w47 = winnerOfMatch(m47);
  const l46 = loserOfMatch(m46);
  const l47 = loserOfMatch(m47);
  if (!w46 || !w47 || !l46 || !l47) throw new Error("M46 et M47 doivent être validés avec un vainqueur.");
  return [
    { match_number: 54, stage: "small_final", home_team_id: l46, away_team_id: l47 },
    { match_number: 55, stage: "final", home_team_id: w46, away_team_id: w47 },
  ];
}

export function challengePointsForRank(rank: number) {
  return rank >= 1 && rank <= 10 ? 21 - rank : 0;
}

export function finalClipetRanking(teams: ClipetTeam[], matches: ClipetMatch[]) {
  const byNumber = new Map(matches.map((m) => [Number(m.match_number ?? 0), m]));
  const m54 = byNumber.get(54);
  const m55 = byNumber.get(55);
  if (!m54 || !m55) return null;
  const w55 = winnerOfMatch(m55), l55 = loserOfMatch(m55), w54 = winnerOfMatch(m54), l54 = loserOfMatch(m54);
  if (!w55 || !l55 || !w54 || !l54) return null;

  const p57 = computeClipetStandings(
    teams.filter((t) => [48,49,50].some((n) => {
      const m = byNumber.get(n); return !!m && (m.home_team_id === t.id || m.away_team_id === t.id);
    })),
    [48,49,50].map((n) => byNumber.get(n)).filter(Boolean) as ClipetMatch[]
  );
  const p810 = computeClipetStandings(
    teams.filter((t) => [51,52,53].some((n) => {
      const m = byNumber.get(n); return !!m && (m.home_team_id === t.id || m.away_team_id === t.id);
    })),
    [51,52,53].map((n) => byNumber.get(n)).filter(Boolean) as ClipetMatch[]
  );

  const ids = [w55, l55, w54, l54, ...p57.map((r) => r.team_id), ...p810.map((r) => r.team_id)];
  if (ids.length !== 10 || new Set(ids).size !== 10) return null;
  const teamMap = new Map(teams.map((t) => [t.id, t]));
  return ids.map((teamId, idx) => ({ rank: idx + 1, team: teamMap.get(teamId)!, challenge_points: challengePointsForRank(idx + 1) }));
}
