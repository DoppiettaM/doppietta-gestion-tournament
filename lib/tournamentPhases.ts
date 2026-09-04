import { rankTournamentTeams, TeamStats } from "@/lib/challenge";

export type PhaseDestination = {
  id: string;
  label: string;
  kind: "group" | "knockout";
  ranks: number[];
  finalPositions: number[];
  seeds?: Array<[number, number]>;
  consolationFinal?: boolean;
};

export type TournamentPhaseConfig = {
  version: 2;
  phaseCount: number;
  assignmentMode: "ranking" | "random" | "manual";
  resetPointsAtPhase2: boolean;
  carryGoalsToPhase2Tiebreak: boolean;
  destinations: PhaseDestination[];
};

export const MICHEL_CLIPET_PHASES: TournamentPhaseConfig = {
  version: 2,
  phaseCount: 2,
  assignmentMode: "ranking",
  resetPointsAtPhase2: true,
  carryGoalsToPhase2Tiebreak: true,
  destinations: [
    { id: "final_table", label: "Phase 2 · Tableau final", kind: "knockout", ranks: [1, 2, 3, 4], finalPositions: [1, 2, 3, 4], seeds: [[1, 4], [2, 3]], consolationFinal: true },
    { id: "group_a", label: "Phase 2 · Poule A (places 5 à 7)", kind: "group", ranks: [5, 6, 7], finalPositions: [5, 6, 7] },
    { id: "group_b", label: "Phase 2 · Poule B (places 8 à 10)", kind: "group", ranks: [8, 9, 10], finalPositions: [8, 9, 10] },
  ],
};

export function normalizePhaseConfig(value: unknown): TournamentPhaseConfig {
  const raw = value && typeof value === "object" ? value as Partial<TournamentPhaseConfig> : {};
  const destinations = Array.isArray(raw.destinations) ? raw.destinations.filter(Boolean) as PhaseDestination[] : [];
  return {
    version: 2,
    phaseCount: Math.max(1, Math.min(6, Number(raw.phaseCount ?? 2))),
    assignmentMode: ["ranking", "random", "manual"].includes(String(raw.assignmentMode)) ? raw.assignmentMode! : "ranking",
    resetPointsAtPhase2: raw.resetPointsAtPhase2 !== false,
    carryGoalsToPhase2Tiebreak: raw.carryGoalsToPhase2Tiebreak !== false,
    destinations: destinations.length ? destinations : MICHEL_CLIPET_PHASES.destinations,
  };
}

type PhaseMatch = { id?: string; match_number?: number | null; stage?: string | null; home_team_id: string | null; away_team_id: string | null; home_score: number | null; away_score: number | null; status?: string };
type PhaseTeam = { id: string; name: string; tournament_id: string; challenge_name?: string | null };

export function rankPhase(teams: PhaseTeam[], matches: PhaseMatch[], tournamentId: string, scoring: { win?: number; draw?: number; loss?: number; goal_bonus?: number } = {}, stages?: string[]) {
  const win = Number(scoring.win ?? 3), draw = Number(scoring.draw ?? 1), loss = Number(scoring.loss ?? 0), bonus = Number(scoring.goal_bonus ?? 0);
  const allowed = stages ? new Set(stages) : null;
  const rows: Omit<TeamStats,"rank"|"goalDifference">[] = teams.filter(t => t.tournament_id === tournamentId).map(team => {
    let played = 0, points = 0, goalsFor = 0, goalsAgainst = 0;
    for (const match of matches) {
      if (allowed && !allowed.has(String(match.stage ?? ""))) continue;
      if (match.status !== "played" || match.home_score == null || match.away_score == null) continue;
      const home = match.home_team_id === team.id, away = match.away_team_id === team.id;
      if (!home && !away) continue;
      const gf = home ? match.home_score : match.away_score, ga = home ? match.away_score : match.home_score;
      played++; goalsFor += gf; goalsAgainst += ga;
      points += (gf > ga ? win : gf === ga ? draw : loss) + gf * bonus;
    }
    return { id: team.id, name: team.name, challengeName: team.challenge_name?.trim() || team.name, tournamentId, played, points, goalsFor, goalsAgainst };
  });
  return rankTournamentTeams(rows);
}

export function resolveMichelAssignments(phaseOne: TeamStats[], matches: PhaseMatch[]) {
  const byRank = (rank: number) => phaseOne[rank - 1]?.id ?? null;
  const updates: Array<{ id: string; home_team_id: string | null; away_team_id: string | null }> = [];
  const byNumber = new Map(matches.map(m => [Number(m.match_number), m]));
  const direct: Record<number, [number, number]> = { 46:[1,4], 47:[2,3], 48:[5,6], 49:[7,5], 50:[6,7], 51:[8,9], 52:[10,8], 53:[9,10] };
  for (const [number, ranks] of Object.entries(direct)) {
    const match = byNumber.get(Number(number)); if (!match?.id) continue;
    updates.push({ id: match.id, home_team_id: byRank(ranks[0]), away_team_id: byRank(ranks[1]) });
  }
  const semi1 = byNumber.get(46), semi2 = byNumber.get(47);
  const winner = (m?: PhaseMatch) => !m || m.status !== "played" || m.home_score == null || m.away_score == null ? null : m.home_score > m.away_score ? m.home_team_id : m.away_team_id;
  const loser = (m?: PhaseMatch) => !m || m.status !== "played" || m.home_score == null || m.away_score == null ? null : m.home_score > m.away_score ? m.away_team_id : m.home_team_id;
  const small = byNumber.get(54), final = byNumber.get(55);
  if (small?.id) updates.push({ id: small.id, home_team_id: loser(semi1), away_team_id: loser(semi2) });
  if (final?.id) updates.push({ id: final.id, home_team_id: winner(semi1), away_team_id: winner(semi2) });
  return updates;
}

export function rankMichelFinal(teams:PhaseTeam[],matches:PhaseMatch[],tournamentId:string,scoring:{win?:number;draw?:number;loss?:number;goal_bonus?:number}={}){
  const phaseOne=rankPhase(teams,matches,tournamentId,scoring,["group","league","phase_1"]); const byId=new Map(phaseOne.map(r=>[r.id,r]));
  const byNumber=new Map(matches.map(m=>[Number(m.match_number),m]));
  const winner=(m?:PhaseMatch)=>!m||m.status!=="played"||m.home_score==null||m.away_score==null?null:m.home_score>m.away_score?m.home_team_id:m.away_team_id;
  const loser=(m?:PhaseMatch)=>!m||m.status!=="played"||m.home_score==null||m.away_score==null?null:m.home_score>m.away_score?m.away_team_id:m.home_team_id;
  const ordered:string[]=[]; const final=byNumber.get(55),small=byNumber.get(54);
  if(winner(final))ordered.push(winner(final)!); if(loser(final))ordered.push(loser(final)!); if(winner(small))ordered.push(winner(small)!); if(loser(small))ordered.push(loser(small)!);
  for(const fallback of phaseOne.slice(0,4))if(!ordered.includes(fallback.id))ordered.push(fallback.id);
  for(const key of ["phase_2_group_a","phase_2_group_b"]){
    const subset=matches.filter(m=>m.stage===key); const ids=new Set(subset.flatMap(m=>[m.home_team_id,m.away_team_id]).filter((x):x is string=>Boolean(x)));
    const rows=rankPhase(teams.filter(t=>ids.has(t.id)),subset,tournamentId,scoring);
    rows.sort((a,b)=>b.points-a.points||(((byId.get(b.id)?.goalDifference??0)+b.goalDifference)-((byId.get(a.id)?.goalDifference??0)+a.goalDifference))||(((byId.get(b.id)?.goalsFor??0)+b.goalsFor)-((byId.get(a.id)?.goalsFor??0)+a.goalsFor)));
    for(const row of rows)if(!ordered.includes(row.id))ordered.push(row.id);
  }
  for(const row of phaseOne)if(!ordered.includes(row.id))ordered.push(row.id);
  return ordered.map((id,index)=>({...byId.get(id)!,rank:index+1})).filter(Boolean);
}
