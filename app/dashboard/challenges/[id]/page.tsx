"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { computeChallengeStandings, rankTournamentTeams, SCORING_LABELS, ScoringMode, TeamStats, TIE_BREAKER_LABELS, TieBreaker } from "@/lib/challenge";

type Challenge = { id: string; title: string; scoring_mode: ScoringMode; default_points_by_rank: number[]; tie_breakers: TieBreaker[]; shared_resources: boolean };
type Link = { tournament_id: string; position: number; points_by_rank: number[] | null; tournament: { id: string; title: string; tournament_date: string | null } | null };
type Team = { id: string; tournament_id: string; name: string; challenge_name: string | null };
type Match = { tournament_id: string; home_team_id: string; away_team_id: string; home_score: number | null; away_score: number | null; status: string };

export default function ChallengeDashboardPage() {
  const router = useRouter(); const params = useParams(); const challengeId = String(params.id);
  const [challenge, setChallenge] = useState<Challenge | null>(null); const [links, setLinks] = useState<Link[]>([]);
  const [teams, setTeams] = useState<Team[]>([]); const [matches, setMatches] = useState<Match[]>([]); const [status, setStatus] = useState("Chargement...");

  async function refresh() {
    const { data: c, error } = await supabase.from("challenges").select("id,title,scoring_mode,default_points_by_rank,tie_breakers,shared_resources").eq("id", challengeId).single();
    if (error) return setStatus("Erreur challenge: " + error.message);
    const { data: l, error: le } = await supabase.from("challenge_tournaments").select("tournament_id,position,points_by_rank,tournament:tournament_id(id,title,tournament_date)").eq("challenge_id", challengeId).order("position");
    if (le) return setStatus("Erreur tournois: " + le.message);
    const linkRows = (l ?? []) as unknown as Link[]; const ids = linkRows.map(x => x.tournament_id);
    const [{ data: teamRows, error: te }, { data: matchRows, error: me }] = await Promise.all([
      supabase.from("teams").select("id,tournament_id,name,challenge_name").in("tournament_id", ids),
      supabase.from("matches").select("tournament_id,home_team_id,away_team_id,home_score,away_score,status").in("tournament_id", ids).eq("status", "played"),
    ]);
    if (te || me) return setStatus("Erreur données: " + (te?.message ?? me?.message));
    setChallenge(c as Challenge); setLinks(linkRows); setTeams((teamRows ?? []) as Team[]); setMatches((matchRows ?? []) as Match[]); setStatus("");
  }
  useEffect(() => { supabase.auth.getUser().then(({ data }) => data.user ? refresh() : router.push("/login")); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [router, challengeId]);

  const rankedTeams = useMemo(() => {
    const result: TeamStats[] = [];
    for (const link of links) {
      const subset = teams.filter(t => t.tournament_id === link.tournament_id);
      const raw = subset.map(team => {
        let played = 0, points = 0, goalsFor = 0, goalsAgainst = 0;
        for (const m of matches.filter(x => x.tournament_id === link.tournament_id)) {
          const home = m.home_team_id === team.id, away = m.away_team_id === team.id;
          if ((!home && !away) || m.home_score == null || m.away_score == null) continue;
          played++; const gf = home ? m.home_score : m.away_score; const ga = home ? m.away_score : m.home_score;
          goalsFor += gf; goalsAgainst += ga; points += gf > ga ? 3 : gf === ga ? 1 : 0;
        }
        return { id: team.id, name: team.name, challengeName: team.challenge_name?.trim() || team.name, tournamentId: team.tournament_id, played, points, goalsFor, goalsAgainst };
      });
      result.push(...rankTournamentTeams(raw));
    }
    return result;
  }, [teams, matches, links]);

  const standings = useMemo(() => {
    if (!challenge) return [];
    const overrides = Object.fromEntries(links.map(x => [x.tournament_id, x.points_by_rank ?? challenge.default_points_by_rank]));
    return computeChallengeStandings(rankedTeams, challenge.scoring_mode, challenge.default_points_by_rank, overrides, challenge.tie_breakers);
  }, [challenge, links, rankedTeams]);

  return <main className="min-h-screen bg-slate-100 p-6"><div className="max-w-7xl mx-auto space-y-4">
    <header className="bg-slate-950 text-white rounded-2xl shadow p-6 flex justify-between gap-4 flex-wrap"><div><p className="text-amber-400 font-bold text-sm">DASHBOARD CHALLENGE</p><h1 className="text-3xl font-black">🏆 {challenge?.title ?? "Challenge"}</h1>{challenge && <p className="text-white/60 mt-1">{SCORING_LABELS[challenge.scoring_mode]} · {challenge.shared_resources ? "ressources partagées" : "ressources séparées"}</p>}</div><div className="flex gap-2 items-start flex-wrap"><button onClick={() => router.push(`/dashboard/challenges/${challengeId}/schedule`)} className="bg-amber-400 text-slate-950 font-bold px-4 py-2 rounded-xl">Planning global</button><button onClick={refresh} className="bg-white/10 px-4 py-2 rounded-xl">↻ Actualiser</button><button onClick={() => router.push("/dashboard/challenges")} className="bg-white/10 px-4 py-2 rounded-xl">← Challenges</button></div></header>
    {status && <div className="bg-white rounded-xl shadow p-4 text-amber-700">{status}</div>}
    <section className="grid lg:grid-cols-3 gap-4"><div className="lg:col-span-2 bg-white rounded-2xl shadow p-6"><div className="flex justify-between mb-4"><h2 className="font-black text-xl">Classement général</h2><span className="text-sm text-gray-500">{standings.length} clubs</span></div><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-gray-500"><th className="p-2">#</th><th>Nom challenge</th><th>Score</th><th>Tournois</th><th>Pts matchs</th><th>BP</th><th>BC</th><th>Diff.</th></tr></thead><tbody>{standings.map((row, i) => <tr key={row.name} className="border-b"><td className="p-2 font-black">{i + 1}</td><td className="font-bold">{row.name}<small className="block font-normal text-gray-400">{row.details.map(d => `${d.teamName}: ${d.score}`).join(" · ")}</small></td><td className="font-black text-amber-600">{row.score}</td><td>{row.tournamentsPlayed}</td><td>{row.tournamentPoints}</td><td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.goalDifference}</td></tr>)}</tbody></table>{!status && standings.length === 0 && <p className="text-gray-500 py-8 text-center">Ajoutez aux équipes un « nom d’équipe pour le challenge » et validez des matchs pour alimenter le classement.</p>}</div></div>
      <aside className="bg-white rounded-2xl shadow p-6"><h2 className="font-black text-xl mb-3">Règlement</h2><p className="text-sm font-semibold">Départage dans l’ordre :</p><ol className="mt-2 space-y-2">{challenge?.tie_breakers.map((rule, i) => <li key={rule} className="bg-slate-50 rounded-xl p-3"><strong>{i + 1}.</strong> {TIE_BREAKER_LABELS[rule]}</li>)}</ol></aside></section>
    <section className="bg-white rounded-2xl shadow p-6"><h2 className="font-black text-xl mb-4">Tournois du challenge ({links.length}/6)</h2><div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">{links.map(link => <button key={link.tournament_id} onClick={() => router.push(`/dashboard/tournaments/${link.tournament_id}`)} className="border rounded-xl p-4 text-left hover:border-amber-400"><span className="text-xs text-gray-400">TOURNOI {link.position}</span><strong className="block mt-1">{link.tournament?.title ?? link.tournament_id}</strong><small className="text-gray-500">{link.tournament?.tournament_date ?? "Date non définie"}</small></button>)}</div></section>
  </div></main>;
}
