"use client";

import { useEffect, useState } from "react";
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
  player: { first_name: string; last_name: string } | null;
};

export default function MatchDetailPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = String(params.id);
  const matchId = String(params.matchId);

  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [status, setStatus] = useState("Chargement...");

  useEffect(() => {
    async function load() {
      const { data: mData } = await supabase
        .from("matches")
        .select(
          "id,home_team_id,away_team_id,home:home_team_id(name),away:away_team_id(name)"
        )
        .eq("id", matchId)
        .single();

      setMatch(mData as any);

      const { data: pData } = await supabase
        .from("players")
        .select("id,first_name,last_name,jersey_number,team_id")
        .eq("tournament_id", tournamentId);

      setPlayers((pData ?? []) as any);

      await refreshEvents();

      setStatus("");
    }

    load();
  }, [matchId, tournamentId]);

  async function refreshEvents() {
    const { data } = await supabase
      .from("match_events")
      .select("id,event_type,player:player_id(first_name,last_name)")
      .eq("match_id", matchId)
      .order("created_at", { ascending: true });

    setEvents((data ?? []) as any);
  }

  async function addEvent(playerId: string, teamId: string, type: string) {
    await supabase.from("match_events").insert({
      tournament_id: tournamentId,
      match_id: matchId,
      team_id: teamId,
      player_id: playerId,
      event_type: type,
    });

    await refreshEvents();
  }

  if (!match) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="max-w-3xl mx-auto bg-white rounded-xl shadow p-6">
          {status}
        </div>
      </main>
    );
  }

  const homePlayers = players.filter(p => p.team_id === match.home_team_id);
  const awayPlayers = players.filter(p => p.team_id === match.away_team_id);

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-4xl mx-auto space-y-6">

        <div className="bg-white rounded-xl shadow p-6">
          <h1 className="text-2xl font-bold">
            {match.home?.name} vs {match.away?.name}
          </h1>
        </div>

        <div className="grid grid-cols-2 gap-6">

          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="font-semibold mb-3">{match.home?.name}</h2>
            {homePlayers.map(p => (
              <div key={p.id} className="flex items-center justify-between mb-2">
                <span>
                  #{p.jersey_number ?? "-"} {p.first_name} {p.last_name}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => addEvent(p.id, p.team_id, "goal")}
                    className="px-2 py-1 bg-green-600 text-white rounded"
                  >
                    ⚽
                  </button>
                  <button
                    onClick={() => addEvent(p.id, p.team_id, "assist")}
                    className="px-2 py-1 bg-blue-600 text-white rounded"
                  >
                    🎯
                  </button>
                  <button
                    onClick={() => addEvent(p.id, p.team_id, "yellow")}
                    className="px-2 py-1 bg-yellow-400 text-black rounded"
                  >
                    🟡
                  </button>
                  <button
                    onClick={() => addEvent(p.id, p.team_id, "red")}
                    className="px-2 py-1 bg-red-600 text-white rounded"
                  >
                    🔴
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="font-semibold mb-3">{match.away?.name}</h2>
            {awayPlayers.map(p => (
              <div key={p.id} className="flex items-center justify-between mb-2">
                <span>
                  #{p.jersey_number ?? "-"} {p.first_name} {p.last_name}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => addEvent(p.id, p.team_id, "goal")}
                    className="px-2 py-1 bg-green-600 text-white rounded"
                  >
                    ⚽
                  </button>
                  <button
                    onClick={() => addEvent(p.id, p.team_id, "assist")}
                    className="px-2 py-1 bg-blue-600 text-white rounded"
                  >
                    🎯
                  </button>
                  <button
                    onClick={() => addEvent(p.id, p.team_id, "yellow")}
                    className="px-2 py-1 bg-yellow-400 text-black rounded"
                  >
                    🟡
                  </button>
                  <button
                    onClick={() => addEvent(p.id, p.team_id, "red")}
                    className="px-2 py-1 bg-red-600 text-white rounded"
                  >
                    🔴
                  </button>
                </div>
              </div>
            ))}
          </div>

        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="font-semibold mb-3">Événements</h2>
          {events.map(e => (
            <div key={e.id} className="text-sm text-gray-700">
              {e.event_type} — {e.player?.first_name} {e.player?.last_name}
            </div>
          ))}
        </div>

        <button
          onClick={() => router.back()}
          className="px-4 py-2 bg-gray-300 rounded"
        >
          Retour
        </button>

      </div>
    </main>
  );
}