export type RankingRule = "points" | "goals_for" | "goals_against" | "goal_difference" | "draw";

export type ScoringRules = {
  win: number;
  draw: number;
  loss: number;
  goalBonus: number;
  ranking: RankingRule[];
};

export type TeamSeed = {
  id: string;
  name: string;
  clubName?: string | null;
  teamNumber?: number | null;
  disqualified?: boolean | null;
  tieBreakLot?: number | null;
};

export type Standing = {
  teamId: string;
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  tieBreakLot: number;
};

export type Result = {
  id?: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  penaltyHome?: number | null;
  penaltyAway?: number | null;
  matchNumber?: number | null;
  phaseKey?: string | null;
  status?: string | null;
};

export type ClipetMatchPlan = {
  number: number;
  phase: string;
  home: string;
  away: string;
  label: string;
};

export const MICHEL_CLIPET_RULES: ScoringRules = {
  win: 8,
  draw: 4,
  loss: 2,
  goalBonus: 1,
  ranking: ["points", "goals_for", "goals_against", "draw"],
};

function fallbackLot(teamId: string) {
  let h = 2166136261;
  for (let i = 0; i < teamId.length; i++) {
    h ^= teamId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function compareStandings(a: Standing, b: Standing, rules: ScoringRules) {
  for (const rule of rules.ranking) {
    if (rule === "points" && a.points !== b.points) return b.points - a.points;
    if (rule === "goals_for" && a.gf !== b.gf) return b.gf - a.gf;
    if (rule === "goals_against" && a.ga !== b.ga) return a.ga - b.ga;
    if (rule === "goal_difference" && a.gd !== b.gd) return b.gd - a.gd;
    if (rule === "draw" && a.tieBreakLot !== b.tieBreakLot) return a.tieBreakLot - b.tieBreakLot;
  }
  return a.name.localeCompare(b.name, "fr");
}

export function computeStandings(teams: TeamSeed[], results: Result[], rules: ScoringRules): Standing[] {
  const map = new Map<string, Standing>();
  for (const t of teams) {
    map.set(t.id, {
      teamId: t.id,
      name: t.name,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      points: 0,
      tieBreakLot: Number.isFinite(Number(t.tieBreakLot)) ? Number(t.tieBreakLot) : fallbackLot(t.id),
    });
  }

  for (const m of results) {
    const h = map.get(m.homeTeamId);
    const a = map.get(m.awayTeamId);
    if (!h || !a || !Number.isFinite(m.homeScore) || !Number.isFinite(m.awayScore)) continue;

    h.played += 1;
    a.played += 1;
    h.gf += m.homeScore;
    h.ga += m.awayScore;
    a.gf += m.awayScore;
    a.ga += m.homeScore;
    h.points += m.homeScore * rules.goalBonus;
    a.points += m.awayScore * rules.goalBonus;

    if (m.homeScore > m.awayScore) {
      h.wins += 1;
      a.losses += 1;
      h.points += rules.win;
      a.points += rules.loss;
    } else if (m.homeScore < m.awayScore) {
      a.wins += 1;
      h.losses += 1;
      a.points += rules.win;
      h.points += rules.loss;
    } else {
      h.draws += 1;
      a.draws += 1;
      h.points += rules.draw;
      a.points += rules.draw;
    }
  }

  const arr = [...map.values()].map((x) => ({ ...x, gd: x.gf - x.ga }));
  return arr.sort((a, b) => compareStandings(a, b, rules));
}

export function roundRobinPairs(teamIds: string[]) {
  const ids = [...teamIds];
  if (ids.length % 2) ids.push("BYE");
  const rounds: { home: string; away: string; round: number }[][] = [];
  for (let r = 0; r < ids.length - 1; r++) {
    const pairs: { home: string; away: string; round: number }[] = [];
    for (let i = 0; i < ids.length / 2; i++) {
      const a = ids[i];
      const b = ids[ids.length - 1 - i];
      if (a !== "BYE" && b !== "BYE") pairs.push(r % 2 ? { home: b, away: a, round: r + 1 } : { home: a, away: b, round: r + 1 });
    }
    rounds.push(pairs);
    ids.splice(1, 0, ids.pop()!);
  }
  return rounds;
}

export function clipetPhase2(rank: string[]): ClipetMatchPlan[] {
  if (rank.length !== 10) throw new Error("Michel Clipet nécessite exactement 10 équipes.");
  return [
    { number: 46, phase: "top4", home: rank[0], away: rank[3], label: "Demi-finale 1" },
    { number: 47, phase: "top4", home: rank[1], away: rank[2], label: "Demi-finale 2" },
    { number: 48, phase: "places5_7", home: rank[4], away: rank[5], label: "Poule 5-7" },
    { number: 49, phase: "places5_7", home: rank[5], away: rank[6], label: "Poule 5-7" },
    { number: 50, phase: "places5_7", home: rank[6], away: rank[4], label: "Poule 5-7" },
    { number: 51, phase: "places8_10", home: rank[7], away: rank[8], label: "Poule 8-10" },
    { number: 52, phase: "places8_10", home: rank[8], away: rank[9], label: "Poule 8-10" },
    { number: 53, phase: "places8_10", home: rank[9], away: rank[7], label: "Poule 8-10" },
  ];
}

export function resolveKnockout(match: Result) {
  if (match.homeScore > match.awayScore) return { winner: match.homeTeamId, loser: match.awayTeamId };
  if (match.awayScore > match.homeScore) return { winner: match.awayTeamId, loser: match.homeTeamId };
  const ph = Number(match.penaltyHome ?? -1);
  const pa = Number(match.penaltyAway ?? -1);
  if (ph > pa) return { winner: match.homeTeamId, loser: match.awayTeamId };
  if (pa > ph) return { winner: match.awayTeamId, loser: match.homeTeamId };
  return null;
}

export function clipetFinalMatches(m46: Result, m47: Result): ClipetMatchPlan[] {
  const a = resolveKnockout(m46);
  const b = resolveKnockout(m47);
  if (!a || !b) throw new Error("Les M46 et M47 doivent être départagés (score ou tirs au but).");
  return [
    { number: 54, phase: "top4", home: a.loser, away: b.loser, label: "Petite finale" },
    { number: 55, phase: "top4", home: a.winner, away: b.winner, label: "Finale" },
  ];
}

function playedResult(m: Result | undefined | null) {
  return !!m && Number.isFinite(m.homeScore) && Number.isFinite(m.awayScore) && (m.status == null || m.status === "played");
}

export function computeClipetFinalRanking(teams: TeamSeed[], matches: Result[]) {
  if (teams.length !== 10) return { complete: false, ranking: [] as string[], reason: "10 équipes requises" };
  const byNo = new Map<number, Result>();
  for (const m of matches) if (m.matchNumber != null) byNo.set(Number(m.matchNumber), m);

  const m54 = byNo.get(54);
  const m55 = byNo.get(55);
  if (!playedResult(m54) || !playedResult(m55)) return { complete: false, ranking: [] as string[], reason: "M54 et M55 non terminés" };
  const bronze = resolveKnockout(m54!);
  const final = resolveKnockout(m55!);
  if (!bronze || !final) return { complete: false, ranking: [] as string[], reason: "Tirs au but manquants en M54/M55" };

  const fiveSevenTeams = teams.filter((t) => [48, 49, 50].some((n) => {
    const m = byNo.get(n); return m?.homeTeamId === t.id || m?.awayTeamId === t.id;
  }));
  const eightTenTeams = teams.filter((t) => [51, 52, 53].some((n) => {
    const m = byNo.get(n); return m?.homeTeamId === t.id || m?.awayTeamId === t.id;
  }));
  const fiveSevenMatches = [48, 49, 50].map((n) => byNo.get(n)).filter(playedResult) as Result[];
  const eightTenMatches = [51, 52, 53].map((n) => byNo.get(n)).filter(playedResult) as Result[];
  if (fiveSevenMatches.length !== 3 || eightTenMatches.length !== 3) {
    return { complete: false, ranking: [] as string[], reason: "Poules de classement M48-M53 incomplètes" };
  }

  const fiveSeven = computeStandings(fiveSevenTeams, fiveSevenMatches, MICHEL_CLIPET_RULES).map((x) => x.teamId);
  const eightTen = computeStandings(eightTenTeams, eightTenMatches, MICHEL_CLIPET_RULES).map((x) => x.teamId);
  return {
    complete: true,
    ranking: [final.winner, final.loser, bronze.winner, bronze.loser, ...fiveSeven, ...eightTen],
    reason: "",
  };
}

export const clipetChallengePoints = (place: number) => (place >= 1 && place <= 10 ? 21 - place : 0);

export type ChallengeCategoryResult = {
  category: string;
  ranking: string[];
  teams: TeamSeed[];
};

export function aggregateClipetChallenge(categories: ChallengeCategoryResult[]) {
  type Row = { key: string; clubName: string; teamNumber: number; total: number; byCategory: Record<string, number> };
  const rows = new Map<string, Row>();
  for (const cat of categories) {
    const byId = new Map(cat.teams.map((t) => [t.id, t]));
    cat.ranking.forEach((teamId, idx) => {
      const t = byId.get(teamId);
      if (!t) return;
      const club = (t.clubName || t.name).trim();
      const num = Math.max(1, Number(t.teamNumber ?? 1));
      const key = `${club.toLocaleLowerCase("fr")}__${num}`;
      const current = rows.get(key) ?? { key, clubName: club, teamNumber: num, total: 0, byCategory: {} };
      const pts = t.disqualified ? 0 : clipetChallengePoints(idx + 1);
      current.byCategory[cat.category] = pts;
      current.total += pts;
      rows.set(key, current);
    });
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || a.clubName.localeCompare(b.clubName, "fr") || a.teamNumber - b.teamNumber);
}
