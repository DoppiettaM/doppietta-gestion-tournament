"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../../lib/supabaseClient";

type MatchRow = {
  id: string;
  status: string;
};

type TeamRow = {
  id: string;
  name: string;
};

type PlayerRow = {
  id: string;
  team_id: string;
  first_name: string | null;
  last_name: string | null;
  jersey_number: number | null;
  team: { name: string } | null;
};

type EventRow = {
  id: string;
  match_id: string;
  player_id: string | null;
  team_id: string | null;
  event_type: string;
};

type StatRow = {
  player_id: string;
  player_name: string;
  team_name: string;
  jersey_number: number | null;
  goals: number;
  assists: number;
  yellows: number;
  reds: number;
  contrib: number; // goals + assists
};

function formatPlayerName(p: { first_name: string | null; last_name: string | null }) {
  const fn = (p.first_name ?? "").trim();
  const ln = (p.last_name ?? "").trim();
  if (fn && ln) return `${fn} ${ln}`;
  return fn || ln || "Joueur";
}

export default function StatsPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = String(params.id);

  const [status, setStatus] = useState("Chargement...");
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [filterTeamId, setFilterTeamId] = useState<string>("ALL");

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return router.push("/login");

      await refreshAll();
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, tournamentId]);

  async function refreshAll() {
    setStatus("Chargement...");

    // Teams
    const { data: tData, error: tErr } = await supabase
      .from("teams")
      .select("id,name")
      .eq("tournament_id", tournamentId)
      .order("name", { ascending: true });

    if (tErr) {
      setStatus("Erreur teams: " + tErr.message);
      return;
    }
    setTeams((tData ?? []) as any);

    // Players (avec team name)
    const { data: pData, error: pErr } = await supabase
      .from("players")
      .select("id,team_id,first_name,last_name,jersey_number,team:team_id(name)")
      .eq("tournament_id", tournamentId)
      .order("team_id", { ascending: true });

    if (pErr) {
      setStatus("Erreur players: " + pErr.message);
      return;
    }
    setPlayers((pData ?? []) as any);

    // Matches played -> ids
    const { data: mData, error: mErr } = await supabase
      .from("matches")
      .select("id,status")
      .eq("tournament_id", tournamentId)
      .eq("status", "played");

    if (mErr) {
      setStatus("Erreur matches: " + mErr.message);
      return;
    }

    const playedIds = ((mData ?? []) as any as MatchRow[]).map((m) => m.id);
    if (playedIds.length === 0) {
      setEvents([]);
      setStatus("");
      return;
    }

    // Events sur les matchs validés uniquement (MVP inclus en DB, mais on l’ignore dans le calcul)
    const { data: eData, error: eErr } = await supabase
      .from("match_events")
      .select("id,match_id,player_id,team_id,event_type")
      .in("match_id", playedIds);

    if (eErr) {
      setStatus("Erreur events: " + eErr.message);
      return;
    }

    setEvents((eData ?? []) as any);
    setStatus("");
  }

  const stats = useMemo<StatRow[]>(() => {
    const byPlayer = new Map<string, StatRow>();

    // init: tous les joueurs (même ceux à 0)
    for (const p of players) {
      byPlayer.set(p.id, {
        player_id: p.id,
        player_name: formatPlayerName(p),
        team_name: p.team?.name ?? "Équipe",
        jersey_number: p.jersey_number,
        goals: 0,
        assists: 0,
        yellows: 0,
        reds: 0,
        contrib: 0,
      });
    }

    for (const e of events) {
      if (!e.player_id) continue;

      const type = (e.event_type ?? "").toLowerCase();
      if (type === "mvp") continue; // MVP exclu des stats publiques

      const row = byPlayer.get(e.player_id);
      if (!row) continue;

      if (type === "goal") row.goals += 1;
      else if (type === "assist") row.assists += 1;
      else if (type === "yellow") row.yellows += 1;
      else if (type === "red") row.reds += 1;
    }

    const arr = Array.from(byPlayer.values()).map((r) => ({
      ...r,
      contrib: r.goals + r.assists,
    }));

    // filtre équipe
    const filtered =
      filterTeamId === "ALL" ? arr : arr.filter((r) => {
        // retrouver team_id via players
        const p = players.find((x) => x.id === r.player_id);
        return (p?.team_id ?? "") === filterTeamId;
      });

    // on affiche surtout ceux qui ont au moins une stat,
    // mais tu peux commenter cette ligne si tu veux afficher tout le monde
    const nonZero = filtered.filter((r) => r.contrib + r.yellows + r.reds > 0);

    // tri: buts desc, passes desc, contrib desc, jaunes asc, rouges asc, nom asc
    nonZero.sort((a, b) => {
      if (b.goals !== a.goals) return b.goals - a.goals;
      if (b.assists !== a.assists) return b.assists - a.assists;
      if (b.contrib !== a.contrib) return b.contrib - a.contrib;
      if (a.yellows !== b.yellows) return a.yellows - b.yellows;
      if (a.reds !== b.reds) return a.reds - b.reds;
      return a.player_name.localeCompare(b.player_name);
    });

    return nonZero;
  }, [events, players, filterTeamId]);

  function jerseyText(n: number | null) {
    return n == null ? "" : `#${n}`;
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-6 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Stats joueurs</h1>
            <p className="text-sm text-gray-500">
              Calcul uniquement sur les matchs <strong>validés</strong> (status = played).
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
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/standings`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Classement
            </button>
            <button
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/schedule`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Planning
            </button>
          </div>
        </div>

        {status && <div className="bg-white rounded-xl shadow p-4 text-gray-700">{status}</div>}

        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h2 className="font-semibold">Classement individuel</h2>

            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600">Filtrer par équipe</label>
              <select
                className="border rounded px-3 py-2"
                value={filterTeamId}
                onChange={(e) => setFilterTeamId(e.target.value)}
              >
                <option value="ALL">Toutes</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>

              <button
                onClick={() => refreshAll()}
                className="bg-gray-200 px-3 py-2 rounded-lg hover:bg-gray-300 transition"
                title="Rafraîchir"
              >
                🔄
              </button>
            </div>
          </div>

          {stats.length === 0 ? (
            <div className="text-gray-600">
              Aucune stat pour le moment. Valide des matchs et ajoute des événements (⚽️/🎯/🟡/🔴).
            </div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600 border-b">
                    <th className="py-2 pr-3">#</th>
                    <th className="py-2 pr-3">Joueur</th>
                    <th className="py-2 pr-3">Équipe</th>
                    <th className="py-2 pr-3">⚽️</th>
                    <th className="py-2 pr-3">🎯</th>
                    <th className="py-2 pr-3">🟡</th>
                    <th className="py-2 pr-3">🔴</th>
                    <th className="py-2 pr-3">Contrib.</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((r, idx) => (
                    <tr key={r.player_id} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-semibold">{idx + 1}</td>
                      <td className="py-2 pr-3">
                        <span className="font-semibold">{r.player_name}</span>{" "}
                        <span className="text-gray-500">{jerseyText(r.jersey_number)}</span>
                      </td>
                      <td className="py-2 pr-3 text-gray-700">{r.team_name}</td>
                      <td className="py-2 pr-3 font-bold">{r.goals}</td>
                      <td className="py-2 pr-3 font-bold">{r.assists}</td>
                      <td className="py-2 pr-3">{r.yellows}</td>
                      <td className="py-2 pr-3">{r.reds}</td>
                      <td className="py-2 pr-3 font-semibold">{r.contrib}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-gray-400">
            Tri: ⚽️ desc, 🎯 desc, contributions desc, discipline (🟡/🔴) asc, puis nom.
          </p>
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