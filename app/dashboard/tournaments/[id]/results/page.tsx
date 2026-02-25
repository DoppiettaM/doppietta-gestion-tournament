"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../../lib/supabaseClient";

type TournamentRow = {
  id: string;
  num_fields: number | null;
  field_names: string[] | null;
};

type MatchRow = {
  id: string;
  start_time: string;
  field_idx: number;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_team_id: string;
  away_team_id: string;
  home: { name: string } | null;
  away: { name: string } | null;
};

type PlayerMini = {
  first_name: string | null;
  last_name: string | null;
  jersey_number: number | null;
};

type EventRow = {
  id: string;
  match_id: string;
  team_id: string | null;
  player_id: string | null;
  event_type: string;
  created_at: string | null;
  player: PlayerMini | null;
};

function normHHMM(t: string) {
  return (t ?? "").slice(0, 5);
}

function iconFor(type: string) {
  const t = (type ?? "").toLowerCase();
  if (t === "goal") return "⚽️";
  if (t === "assist") return "🎯";
  if (t === "yellow") return "🟡";
  if (t === "red") return "🔴";
  return "•";
}

function formatName(p: PlayerMini | null) {
  const fn = (p?.first_name ?? "").trim();
  const ln = (p?.last_name ?? "").trim();
  if (fn && ln) return `${fn} ${ln}`;
  return fn || ln || "Joueur";
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export default function ResultsPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = String(params.id);

  const [status, setStatus] = useState("Chargement...");
  const [tournament, setTournament] = useState<TournamentRow | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);

  // ✅ anti-spam refresh (si plusieurs events realtime arrivent d’un coup)
  const refreshTimerRef = useRef<number | null>(null);
  const pollRef = useRef<number | null>(null);

  const eventsByMatch = useMemo(() => {
    const m = new Map<string, EventRow[]>();
    for (const e of events) {
      if (!m.has(e.match_id)) m.set(e.match_id, []);
      m.get(e.match_id)!.push(e);
    }
    for (const [k, arr] of m.entries()) {
      arr.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
      m.set(k, arr);
    }
    return m;
  }, [events]);

  // ✅ noms de terrains personnalisés
  const fieldLabel = useMemo(() => {
    const raw = Array.isArray(tournament?.field_names) ? tournament!.field_names! : [];
    const nf = clampInt(Number(tournament?.num_fields ?? raw.length ?? 0), 1, 24);

    return (fieldIdx: number) => {
      const idx = Math.max(1, Number(fieldIdx || 1));
      const nm = String(raw[idx - 1] ?? "").trim();
      // fallback si pas de nom: "Terrain X"
      if (!nm) return `Terrain ${idx}`;
      // option: si tu veux afficher juste le nom sans "Terrain"
      return nm;
    };
  }, [tournament]);

  function scheduleRefresh(reason: string) {
    // console.log("results scheduleRefresh:", reason);
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshAll();
    }, 250);
  }

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return router.push("/login");

      await refreshAll();
      setStatus("");
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
      // résultats = dépend matches played + events + (noms terrains)
      refreshAll();
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

  // ✅ Realtime Supabase: matches + match_events + tournaments (pour noms terrains)
  useEffect(() => {
    const ch = supabase
      .channel(`results_${tournamentId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "matches", filter: `tournament_id=eq.${tournamentId}` },
        () => scheduleRefresh("matches_changed")
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "match_events", filter: `tournament_id=eq.${tournamentId}` },
        () => scheduleRefresh("events_changed")
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

  async function refreshAll() {
    // ✅ tournoi (noms terrains)
    const { data: tData, error: tErr } = await supabase
      .from("tournaments")
      .select("id,num_fields,field_names")
      .eq("id", tournamentId)
      .single();

    if (!tErr) setTournament((tData ?? null) as any);

    const { data: mData, error: mErr } = await supabase
      .from("matches")
      .select(
        "id,start_time,field_idx,status,home_score,away_score,home_team_id,away_team_id,home:home_team_id(name),away:away_team_id(name)"
      )
      .eq("tournament_id", tournamentId)
      .eq("status", "played")
      .order("start_time", { ascending: true })
      .order("field_idx", { ascending: true });

    if (mErr) {
      setStatus("Erreur matches: " + mErr.message);
      return;
    }

    const played = (mData ?? []) as any as MatchRow[];
    setMatches(played);

    const matchIds = played.map((m) => m.id);
    if (matchIds.length === 0) {
      setEvents([]);
      return;
    }

    const { data: eData, error: eErr } = await supabase
      .from("match_events")
      .select("id,match_id,team_id,player_id,event_type,created_at,player:player_id(first_name,last_name,jersey_number)")
      .in("match_id", matchIds);

    if (eErr) {
      setEvents([]);
      setStatus("Events non chargés : " + eErr.message);
      return;
    }

    // ✅ MVP masqués dans Résultats + écran
    const all = ((eData ?? []) as any as EventRow[]).filter((e) => (e.event_type ?? "").toLowerCase() !== "mvp");

    setEvents(all);
  }

  function renderEvent(e: EventRow, teamName: string) {
    const icon = iconFor(e.event_type);
    const name = formatName(e.player);
    const num = e.player?.jersey_number;
    const inside = `${num != null ? `#${num} ` : ""}${teamName}`.trim();
    return `${icon} ${name} (${inside})`;
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Résultats</h1>
            <p className="text-sm text-gray-500">Affiche buts/passes/cartons. MVP non affichés ici.</p>
          </div>

          <div className="flex gap-2 flex-wrap justify-end">
            <button
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/matches`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Matchs
            </button>
            <button
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/standings`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Classement
            </button>
            <button
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/stats`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Stats
            </button>
            <button
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/screen`)}
              className="bg-black text-white px-4 py-2 rounded-lg hover:bg-gray-900 transition"
              title="Mode écran géant"
            >
              🎥 Écran
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

        <div className="bg-white rounded-xl shadow p-6 space-y-3">
          {matches.length === 0 ? (
            <div className="text-gray-600">Aucun match validé pour le moment.</div>
          ) : (
            matches.map((m) => {
              const evs = eventsByMatch.get(m.id) ?? [];
              const homeName = m.home?.name ?? "Équipe A";
              const awayName = m.away?.name ?? "Équipe B";
              const terrain = fieldLabel(m.field_idx);

              return (
                <div key={m.id} className="border rounded-lg p-4">
                  {/* ✅ tout plus petit */}
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="text-xs text-gray-600 font-semibold">
                      <strong>{normHHMM(m.start_time)}</strong> · <span className="font-bold">{terrain}</span>
                    </div>

                    <div className="text-sm font-extrabold">
                      {homeName}{" "}
                      <span className="mx-2 font-extrabold">
                        {m.home_score ?? 0} - {m.away_score ?? 0}
                      </span>{" "}
                      {awayName}
                    </div>
                  </div>

                  {evs.length > 0 ? (
                    <div className="mt-3 text-xs text-gray-900 space-y-1">
                      {evs.map((e) => {
                        const tId = e.team_id ?? "";
                        const teamName = tId === m.home_team_id ? homeName : tId === m.away_team_id ? awayName : "Équipe";
                        return (
                          <div key={e.id} className="font-semibold">
                            {renderEvent(e, teamName)}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="mt-3 text-xs text-gray-500">Aucun événement renseigné.</div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </main>
  );
}