"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../../lib/supabaseClient";

type TournamentRow = {
  id: string;
  format: string | null; // "round_robin" | "groups_round_robin"
  group_count: number | null; // 1..8
  group_names: string[] | null;
};

type TeamRow = {
  id: string;
  name: string;
  group_idx?: number | null; // ✅ pour séparer par poule
};

type MatchRow = {
  id: string;
  home_team_id: string;
  away_team_id: string;
  home_score: number | null;
  away_score: number | null;
  status: string;
};

type StandingRow = {
  team_id: string;
  team_name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
};

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export default function StandingsPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = String(params.id);

  const [status, setStatus] = useState("Chargement...");
  const [tournament, setTournament] = useState<TournamentRow | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [pointsWin, setPointsWin] = useState(3);
  const [pointsDraw, setPointsDraw] = useState(1);
  const [pointsLoss, setPointsLoss] = useState(0);

  const refreshTimerRef = useRef<number | null>(null);
  const pollRef = useRef<number | null>(null);

  function scheduleRefresh(reason: string) {
    // console.log("standings scheduleRefresh:", reason);
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshAll();
    }, 250);
  }

  async function refreshTournament() {
    const { data, error } = await supabase
      .from("tournaments")
      .select("id,format,group_count,group_names")
      .eq("id", tournamentId)
      .single();

    if (error) {
      // on ne bloque pas la page si ça rate, mais on garde un status visible
      setStatus("Erreur tournoi: " + error.message);
      return null;
    }

    setTournament((data ?? null) as any);
    return data as any as TournamentRow;
  }

  async function refreshTeams() {
    // ✅ On récupère group_idx pour séparer par poules
    const { data: tData, error: tErr } = await supabase
      .from("teams")
      .select("id,name,group_idx")
      .eq("tournament_id", tournamentId)
      .order("name", { ascending: true });

    if (tErr) {
      setStatus("Erreur teams: " + tErr.message);
      return null;
    }

    setTeams((tData ?? []) as any);
    return (tData ?? []) as any as TeamRow[];
  }

  async function refreshPlayedMatches() {
    const { data: mData, error: mErr } = await supabase
      .from("matches")
      .select("id,home_team_id,away_team_id,home_score,away_score,status")
      .eq("tournament_id", tournamentId)
      .eq("status", "played");

    if (mErr) {
      setStatus("Erreur matches: " + mErr.message);
      return null;
    }

    setMatches((mData ?? []) as any);
    return (mData ?? []) as any as MatchRow[];
  }

  async function refreshAll() {
    setStatus("Chargement...");
    await refreshTournament();
    await refreshTeams();
    await refreshPlayedMatches();
    setStatus("");
  }

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return router.push("/login");

      await refreshAll();
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, tournamentId]);

  // ✅ Auto-refresh: focus + visibility + polling
  useEffect(() => {
    const onFocus = () => scheduleRefresh("focus");
    const onVis = () => {
      if (document.visibilityState === "visible") scheduleRefresh("visible");
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    pollRef.current = window.setInterval(() => {
      // standings dépend des matches played + teams (+ tournoi pour noms de poules)
      refreshPlayedMatches();
      refreshTeams();
      refreshTournament();
    }, 12_000);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);

      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;

      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  // ✅ Realtime Supabase: teams + matches + tournaments
  useEffect(() => {
    const ch = supabase
      .channel(`standings_${tournamentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "teams", filter: `tournament_id=eq.${tournamentId}` },
        () => scheduleRefresh("teams_changed")
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `tournament_id=eq.${tournamentId}` },
        () => scheduleRefresh("matches_changed")
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournaments", filter: `id=eq.${tournamentId}` },
        () => scheduleRefresh("tournament_changed")
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  // ✅ Détection poules + noms
  const showGroups = useMemo(() => (tournament?.format ?? "") === "groups_round_robin", [tournament]);

  const groupNames = useMemo(() => {
    const raw = Array.isArray(tournament?.group_names) ? (tournament?.group_names as any[]) : [];
    const n = clampInt(Number(tournament?.group_count ?? 1), 1, 8);
    const out: string[] = [];
    for (let i = 1; i <= n; i++) {
      const s = String(raw[i - 1] ?? "").trim();
      out.push(s || `Poule ${i}`);
    }
    return out;
  }, [tournament]);

  function computeStandingsForTeams(teamSubset: TeamRow[]) {
    const byId = new Map<string, StandingRow>();

    for (const t of teamSubset) {
      byId.set(t.id, {
        team_id: t.id,
        team_name: t.name,
        played: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        gf: 0,
        ga: 0,
        gd: 0,
        pts: 0,
      });
    }

    for (const m of matches) {
      if (m.home_score == null || m.away_score == null) continue;

      const home = byId.get(m.home_team_id);
      const away = byId.get(m.away_team_id);

      // ✅ Important: en mode poules, on ne compte que si les 2 équipes sont dans ce subset
      if (!home || !away) continue;

      home.played += 1;
      away.played += 1;

      home.gf += m.home_score;
      home.ga += m.away_score;

      away.gf += m.away_score;
      away.ga += m.home_score;

      if (m.home_score > m.away_score) {
        home.wins += 1;
        away.losses += 1;
        home.pts += pointsWin;
        away.pts += pointsLoss;
      } else if (m.home_score < m.away_score) {
        away.wins += 1;
        home.losses += 1;
        away.pts += pointsWin;
        home.pts += pointsLoss;
      } else {
        home.draws += 1;
        away.draws += 1;
        home.pts += pointsDraw;
        away.pts += pointsDraw;
      }
    }

    const arr = Array.from(byId.values()).map((r) => ({
      ...r,
      gd: r.gf - r.ga,
    }));

    // Tri: points desc, diff buts desc, buts marqués desc, nom asc
    arr.sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.gd !== a.gd) return b.gd - a.gd;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return a.team_name.localeCompare(b.team_name);
    });

    return arr;
  }

  // ✅ Standings global (mode normal) = inchangé
  const standings = useMemo<StandingRow[]>(() => {
    return computeStandingsForTeams(teams);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, matches, pointsWin, pointsDraw, pointsLoss]);

  // ✅ Standings par poule (si poules)
  const standingsByGroup = useMemo(() => {
    if (!showGroups) return null;

    const n = clampInt(Number(tournament?.group_count ?? 1), 1, 8);
    if (n <= 1) return null;

    const groups: { groupIdx: number; label: string; rows: StandingRow[]; teamCount: number }[] = [];

    for (let g = 1; g <= n; g++) {
      const label = groupNames[g - 1] ?? `Poule ${g}`;
      const subset = teams.filter((t) => Number(t.group_idx ?? 0) === g);
      const rows = computeStandingsForTeams(subset);
      groups.push({ groupIdx: g, label, rows, teamCount: subset.length });
    }

    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGroups, tournament, groupNames, teams, matches, pointsWin, pointsDraw, pointsLoss]);

  const playedCount = matches.filter((m) => m.home_score != null && m.away_score != null).length;

  function StandingsTable({ rows }: { rows: StandingRow[] }) {
    return (
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-600 border-b">
              <th className="py-2 pr-3">#</th>
              <th className="py-2 pr-3">Équipe</th>
              <th className="py-2 pr-3">Pts</th>
              <th className="py-2 pr-3">J</th>
              <th className="py-2 pr-3">G</th>
              <th className="py-2 pr-3">N</th>
              <th className="py-2 pr-3">P</th>
              <th className="py-2 pr-3">BP</th>
              <th className="py-2 pr-3">BC</th>
              <th className="py-2 pr-3">Diff</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.team_id} className="border-b last:border-0">
                <td className="py-2 pr-3 font-semibold">{idx + 1}</td>
                <td className="py-2 pr-3">{r.team_name}</td>
                <td className="py-2 pr-3 font-bold">{r.pts}</td>
                <td className="py-2 pr-3">{r.played}</td>
                <td className="py-2 pr-3">{r.wins}</td>
                <td className="py-2 pr-3">{r.draws}</td>
                <td className="py-2 pr-3">{r.losses}</td>
                <td className="py-2 pr-3">{r.gf}</td>
                <td className="py-2 pr-3">{r.ga}</td>
                <td className="py-2 pr-3 font-semibold">{r.gd}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Classement</h1>
            <p className="text-sm text-gray-500">
              Calcul automatique sur les matchs <strong>validés</strong> (status = played).
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Matchs pris en compte: <strong>{playedCount}</strong> · Équipes: <strong>{teams.length}</strong>
            </p>
          </div>

          <div className="flex gap-2 flex-wrap justify-end">
            <button
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/matches`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Matchs
            </button>
            <button
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/results`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Résultats
            </button>
            <button
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/schedule`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Planning
            </button>
            <button
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/teams`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Équipes
            </button>
          </div>
        </div>

        {status && <div className="bg-white rounded-xl shadow p-4 text-gray-700">{status}</div>}

        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <h2 className="font-semibold">Paramètres points</h2>

            <div className="flex items-center gap-3 text-sm">
              <label className="flex items-center gap-2">
                Victoire
                <input
                  type="number"
                  className="w-16 border rounded px-2 py-1"
                  value={pointsWin}
                  onChange={(e) => setPointsWin(Number(e.target.value))}
                />
              </label>

              <label className="flex items-center gap-2">
                Nul
                <input
                  type="number"
                  className="w-16 border rounded px-2 py-1"
                  value={pointsDraw}
                  onChange={(e) => setPointsDraw(Number(e.target.value))}
                />
              </label>

              <label className="flex items-center gap-2">
                Défaite
                <input
                  type="number"
                  className="w-16 border rounded px-2 py-1"
                  value={pointsLoss}
                  onChange={(e) => setPointsLoss(Number(e.target.value))}
                />
              </label>
            </div>
          </div>

          {/* ✅ SI plusieurs poules : une table par poule (nom personnalisé) */}
          {standingsByGroup ? (
            <div className="space-y-4">
              {standingsByGroup.map((g) => (
                <div key={g.groupIdx} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                    <div className="font-extrabold text-lg">📍 {g.label}</div>
                    <div className="text-xs text-gray-500 font-semibold">
                      Équipes: <strong>{g.teamCount}</strong>
                    </div>
                  </div>

                  {g.teamCount === 0 ? (
                    <div className="text-sm text-gray-500">Aucune équipe dans cette poule.</div>
                  ) : (
                    <StandingsTable rows={g.rows} />
                  )}
                </div>
              ))}
            </div>
          ) : (
            // ✅ MODE CLASSIQUE (inchangé)
            <>
              <StandingsTable rows={standings} />

              <p className="text-xs text-gray-400 mt-3">
                Tri automatique: Pts ↓, Diff ↓, BP ↓, Nom ↑. (On ajoutera confrontation directe ensuite si tu veux.)
              </p>
            </>
          )}

          {/* Dans le mode poules aussi, on garde la note de tri */}
          {standingsByGroup && (
            <p className="text-xs text-gray-400 mt-3">
              Tri automatique (par poule): Pts ↓, Diff ↓, BP ↓, Nom ↑. (On ajoutera confrontation directe ensuite si tu veux.)
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <button onClick={() => router.back()} className="px-4 py-2 bg-gray-300 rounded">
            Retour
          </button>
        </div>
      </div>
    </main>
  );
}