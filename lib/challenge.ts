export type ScoringMode = "placement_points" | "tournament_points" | "goals_scored";
export type TieBreaker = "points" | "goals_scored" | "goal_difference" | "goals_conceded" | "penalty_shootout" | "draw";

export const SCORING_LABELS: Record<ScoringMode, string> = {
  placement_points: "Points selon la place finale",
  tournament_points: "Points réellement obtenus dans chaque tournoi",
  goals_scored: "Total des buts inscrits",
};

export const TIE_BREAKER_LABELS: Record<TieBreaker, string> = {
  points: "Points",
  goals_scored: "Buts inscrits",
  goal_difference: "Différence de buts",
  goals_conceded: "Buts concédés (plus petit total)",
  penalty_shootout: "Séance de tirs au but",
  draw: "Tirage au sort",
};

export type TeamStats = {
  id: string;
  name: string;
  challengeName: string;
  tournamentId: string;
  played: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  rank: number;
};

export type ChallengeStanding = {
  name: string;
  score: number;
  tournamentPoints: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  tournamentsPlayed: number;
  details: Array<{ tournamentId: string; teamName: string; rank: number; score: number }>;
};

export function rankTournamentTeams(rows: Omit<TeamStats, "rank" | "goalDifference">[]): TeamStats[] {
  return rows
    .map((row) => ({ ...row, rank: 0, goalDifference: row.goalsFor - row.goalsAgainst }))
    .sort((a, b) => b.points - a.points || b.goalDifference - a.goalDifference || b.goalsFor - a.goalsFor || a.name.localeCompare(b.name, "fr"))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function computeChallengeStandings(
  teams: TeamStats[],
  scoringMode: ScoringMode,
  defaultPointsByRank: number[],
  pointsByTournament: Record<string, number[]>,
  tieBreakers: TieBreaker[]
): ChallengeStanding[] {
  const grouped = new Map<string, ChallengeStanding>();
  for (const team of teams) {
    const key = team.challengeName.trim().toLocaleLowerCase("fr");
    if (!key) continue;
    const rankScale = pointsByTournament[team.tournamentId] ?? defaultPointsByRank;
    const score = scoringMode === "placement_points"
      ? Number(rankScale[team.rank - 1] ?? 0)
      : scoringMode === "tournament_points" ? team.points : team.goalsFor;
    const current = grouped.get(key) ?? {
      name: team.challengeName.trim(), score: 0, tournamentPoints: 0, goalsFor: 0,
      goalsAgainst: 0, goalDifference: 0, tournamentsPlayed: 0, details: [],
    };
    current.score += score;
    current.tournamentPoints += team.points;
    current.goalsFor += team.goalsFor;
    current.goalsAgainst += team.goalsAgainst;
    current.goalDifference = current.goalsFor - current.goalsAgainst;
    current.tournamentsPlayed += 1;
    current.details.push({ tournamentId: team.tournamentId, teamName: team.name, rank: team.rank, score });
    grouped.set(key, current);
  }

  const value = (row: ChallengeStanding, rule: TieBreaker) => {
    if (rule === "points") return row.score;
    if (rule === "goals_scored") return row.goalsFor;
    if (rule === "goal_difference") return row.goalDifference;
    if (rule === "goals_conceded") return -row.goalsAgainst;
    return 0;
  };
  return Array.from(grouped.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    for (const rule of tieBreakers) {
      const diff = value(b, rule) - value(a, rule);
      if (diff) return diff;
    }
    return a.name.localeCompare(b.name, "fr");
  });
}

