"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../../../lib/supabaseClient";

type MatchInfo = {
  id: string;
  home_team_id: string;
  away_team_id: string;
  home: { name: string } | null;
  away: { name: string } | null;
};

type Player = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  jersey_number: number | null;
  team_id: string;
};

type EventRow = {
  id: string;
  event_type: string;
  created_at: string | null;
  team_id: string | null;
  player_id: string | null;
  player: { first_name: string | null; last_name: string | null; jersey_number: number | null } | null;
};

function iconFor(type: string) {
  const t = (type ?? "").toLowerCase();
  if (t === "goal") return "⚽️";
  if (t === "assist") return "🎯";
  if (t === "yellow") return "🟡";
  if (t === "red") return "🔴";
  if (t === "mvp") return "⭐";
  return "•";
}

function formatPlayerName(p: EventRow["player"]) {
  const fn = (p?.first_name ?? "").trim();
  const ln = (p?.last_name ?? "").trim();
  if (fn && ln) return `${fn} ${ln}`;
  if (fn) return fn;
  if (ln) return ln;
  return "Joueur";
}

export default function MatchDetailPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = String(params.id);
  const matchId = String(params.matchId);

  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [status, setStatus] = useState("Chargement...");

  const teamNameById = useMemo(() => {
    const m = new Map<string, string>();
    if (match?.home_team_id) m.set(match.home_team_id, match.home?.name ?? "Équipe");
    if (match?.away_team_id) m.set(match.away_team_id, match.away?.name ?? "Équipe");
    return m;
  }, [match]);

  function formatEventLine(e: EventRow) {
    const icon = iconFor(e.event_type);
    const name = formatPlayerName(e.player);
    const num = e.player?.jersey_number;
    const teamName = e.team_id ? teamNameById.get(e.team_id) : undefined;

    const inside = `${num != null ? `#${num} ` : ""}${teamName ?? "Équipe"}`.trim();
    return `${icon} ${name} (${inside})`;
  }

  const homePlayers = useMemo(() => {
    if (!match) return [];
    return players.filter((p) => p.team_id === match.home_team_id);
  }, [players, match]);

  const awayPlayers = useMemo(() => {
    if (!match) return [];
    return players.filter((p) => p.team_id === match.away_team_id);
  }, [players, match]);

  const mvpByTeam = useMemo(() => {
    const map = new Map<string, string>(); // team_id -> player_id
    for (const e of events) {
      if (e.event_type === "mvp" && e.team_id && e.player_id) {
        map.set(e.team_id, e.player_id);
      }
    }
    return map;
  }, [events]);

  function countPlayerEvents(playerId: string, type: string) {
    const t = (type ?? "").toLowerCase();
    return events.filter(
      (e) => (e.player_id ?? "") === playerId && (e.event_type ?? "").toLowerCase() === t
    ).length;
  }

  function hasPlayerEvent(playerId: string, type: string) {
    return countPlayerEvents(playerId, type) > 0;
  }

  useEffect(() => {
    async function load() {
      setStatus("Chargement...");

      const { data: mData, error: mErr } = await supabase
        .from("matches")
        .select("id,home_team_id,away_team_id,home:home_team_id(name),away:away_team_id(name)")
        .eq("id", matchId)
        .single();

      if (mErr) {
        setStatus("Erreur match: " + mErr.message);
        return;
      }

      setMatch(mData as any);

      const { data: pData, error: pErr } = await supabase
        .from("players")
        .select("id,first_name,last_name,jersey_number,team_id")
        .eq("tournament_id", tournamentId);

      if (pErr) {
        setStatus("Erreur players: " + pErr.message);
        return;
      }

      setPlayers((pData ?? []) as any);

      await refreshEvents();
      setStatus("");
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, tournamentId]);

  async function refreshEvents() {
    const { data, error } = await supabase
      .from("match_events")
      .select("id,event_type,created_at,team_id,player_id,player:player_id(first_name,last_name,jersey_number)")
      .eq("match_id", matchId)
      .order("created_at", { ascending: true });

    if (error) {
      setStatus("Erreur events: " + error.message);
      return;
    }

    setEvents((data ?? []) as any);
  }

  async function insertEvent(playerId: string, teamId: string, type: string) {
    const { error } = await supabase.from("match_events").insert({
      tournament_id: tournamentId,
      match_id: matchId,
      team_id: teamId,
      player_id: playerId,
      event_type: type,
    });
    return error;
  }

  async function deleteEvent(eventId: string) {
    setStatus("");

    const ok = window.confirm("Supprimer cet événement ?");
    if (!ok) return;

    const { error } = await supabase.from("match_events").delete().eq("id", eventId);

    if (error) {
      setStatus("Erreur suppression event: " + error.message);
      return;
    }

    await refreshEvents();
  }

  async function addEvent(playerId: string, teamId: string, type: string) {
    setStatus("");
    const t = (type ?? "").toLowerCase();

    // ⭐ MVP: 1 seul par équipe => remplace si existe déjà
    if (t === "mvp") {
      const existing = mvpByTeam.get(teamId);
      if (existing) {
        const { error: delErr } = await supabase
          .from("match_events")
          .delete()
          .eq("match_id", matchId)
          .eq("team_id", teamId)
          .eq("event_type", "mvp");

        if (delErr) {
          setStatus("Erreur remplacement MVP: " + delErr.message);
          return;
        }
      }
      const err = await insertEvent(playerId, teamId, "mvp");
      if (err) {
        setStatus("Erreur ajout MVP: " + err.message);
        return;
      }
      await refreshEvents();
      return;
    }

    // 🔴 Rouge: max 1 par joueur / match
    if (t === "red") {
      if (hasPlayerEvent(playerId, "red")) {
        setStatus("Ce joueur a déjà un 🔴 rouge sur ce match.");
        return;
      }
      const err = await insertEvent(playerId, teamId, "red");
      if (err) {
        setStatus("Erreur ajout rouge: " + err.message);
        return;
      }
      await refreshEvents();
      return;
    }

    // 🟡 Jaune: max 2 par joueur / match
    // 2e jaune => ajoute automatiquement 🔴 (si pas déjà rouge)
    if (t === "yellow") {
      const yellows = countPlayerEvents(playerId, "yellow");
      if (yellows >= 2) {
        setStatus("Ce joueur a déjà 2 🟡 jaunes sur ce match (maximum atteint).");
        return;
      }

      const errYellow = await insertEvent(playerId, teamId, "yellow");
      if (errYellow) {
        setStatus("Erreur ajout jaune: " + errYellow.message);
        return;
      }

      if (yellows === 1) {
        if (!hasPlayerEvent(playerId, "red")) {
          const errRed = await insertEvent(playerId, teamId, "red");
          if (errRed) {
            setStatus("Jaune ajouté, mais erreur ajout 🔴 rouge auto: " + errRed.message);
            await refreshEvents();
            return;
          }
        }
      }

      await refreshEvents();
      return;
    }

    // ⚽️ / 🎯 illimités
    const err = await insertEvent(playerId, teamId, t);
    if (err) {
      setStatus("Erreur ajout event: " + err.message);
      return;
    }
    await refreshEvents();
  }

  if (!match) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="max-w-3xl mx-auto bg-white rounded-xl shadow p-6">{status}</div>
      </main>
    );
  }

  function PlayerRow({ p }: { p: Player }) {
    const isMvp = mvpByTeam.get(p.team_id) === p.id;

    return (
      <div className="flex items-center justify-between mb-2">
        <span className={isMvp ? "font-bold" : ""}>
          #{p.jersey_number ?? "-"} {p.first_name ?? ""} {p.last_name ?? ""}
          {isMvp ? " ⭐" : ""}
        </span>

        <div className="flex gap-2">
          <button onClick={() => addEvent(p.id, p.team_id, "goal")} className="px-2 py-1 bg-green-600 text-white rounded" title="But">
            ⚽
          </button>
          <button onClick={() => addEvent(p.id, p.team_id, "assist")} className="px-2 py-1 bg-blue-600 text-white rounded" title="Passe">
            🎯
          </button>
          <button
            onClick={() => addEvent(p.id, p.team_id, "yellow")}
            className="px-2 py-1 bg-yellow-400 text-black rounded"
            title="Carton jaune (max 2, le 2e entraîne un rouge)"
          >
            🟡
          </button>
          <button onClick={() => addEvent(p.id, p.team_id, "red")} className="px-2 py-1 bg-red-600 text-white rounded" title="Carton rouge (max 1)">
            🔴
          </button>
          <button
            onClick={() => addEvent(p.id, p.team_id, "mvp")}
            className={`px-2 py-1 rounded ${isMvp ? "bg-amber-500 text-white" : "bg-gray-200 hover:bg-gray-300"}`}
            title="MVP (1 par équipe)"
          >
            ⭐
          </button>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="bg-white rounded-xl shadow p-6">
          <h1 className="text-2xl font-bold">
            {match.home?.name} vs {match.away?.name}
          </h1>

          {status && <p className="mt-2 text-sm text-gray-700">{status}</p>}

          <p className="mt-2 text-sm text-gray-500">
            Règles: 🟡 max 2 (le 2e ajoute 🔴), 🔴 max 1, ⭐ MVP = 1 par équipe. Supprime via ✖ si erreur.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="font-semibold mb-3">{match.home?.name}</h2>
            {homePlayers.length === 0 ? (
              <div className="text-sm text-gray-500">Aucun joueur.</div>
            ) : (
              homePlayers.map((p) => <PlayerRow key={p.id} p={p} />)
            )}
          </div>

          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="font-semibold mb-3">{match.away?.name}</h2>
            {awayPlayers.length === 0 ? (
              <div className="text-sm text-gray-500">Aucun joueur.</div>
            ) : (
              awayPlayers.map((p) => <PlayerRow key={p.id} p={p} />)
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="font-semibold mb-3">Événements</h2>

          {events.length === 0 ? (
            <div className="text-sm text-gray-500">Aucun événement pour le moment.</div>
          ) : (
            <div className="space-y-1">
              {events.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3">
                  <div className="text-sm text-gray-800 font-semibold">{formatEventLine(e)}</div>

                  <button
                    onClick={() => deleteEvent(e.id)}
                    className="text-gray-400 hover:text-red-600 px-2 py-1"
                    title="Supprimer"
                    aria-label="Supprimer"
                  >
                    ✖
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={() => router.back()} className="px-4 py-2 bg-gray-300 rounded">
          Retour
        </button>
      </div>
    </main>
  );
}