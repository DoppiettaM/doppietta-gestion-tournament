"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../lib/supabaseClient";

type TournamentRow = {
  id: string;
  title: string | null;
  created_at: string | null;
  match_duration_min: number | null;
  rotation_duration_min: number | null;
  format?: string | null;
  category?: string | null;
  challenge_id?: string | null;
};

type NextMatchRow = {
  id: string;
  start_time: string;
  field_idx: number;
  status: string;
  home: { name: string } | null;
  away: { name: string } | null;
};

type LastPlayedRow = {
  id: string;
  start_time: string;
  field_idx: number;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home: { name: string } | null;
  away: { name: string } | null;
};

type LiveMatchRow = {
  id: string;
  start_time: string;
  field_idx: number;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home: { name: string } | null;
  away: { name: string } | null;
};

type TopScorerRow = {
  player_id: string;
  first_name: string | null;
  last_name: string | null;
  jersey_number: number | null;
  team_name: string | null;
  goals: number;
};

function prettyDateTime(iso: string | null) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("fr-FR");
  } catch {
    return iso;
  }
}

function hhmmFromIso(iso: string | null) {
  if (!iso) return "";

  const maybe = (iso ?? "").slice(11, 16);
  if (maybe.includes(":")) return maybe;

  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(iso).trim());
  if (m) {
    const hh = String(Math.min(23, Math.max(0, Number(m[1])))).padStart(2, "0");
    const mm = String(Math.min(59, Math.max(0, Number(m[2])))).padStart(2, "0");
    return `${hh}:${mm}`;
  }
  return "";
}

function fullName(fn: string | null, ln: string | null) {
  const a = (fn ?? "").trim();
  const b = (ln ?? "").trim();
  if (a && b) return `${a} ${b}`;
  return a || b || "Joueur";
}

function safeUrlEncode(s: string) {
  try {
    return encodeURIComponent(s);
  } catch {
    return s;
  }
}

function parseMsLoose(v: string | null) {
  if (!v) return NaN;

  const ms = Date.parse(v);
  if (!Number.isNaN(ms)) return ms;

  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(v).trim());
  if (m) {
    const hh = Math.min(23, Math.max(0, Number(m[1])));
    const mm = Math.min(59, Math.max(0, Number(m[2])));
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    return d.getTime();
  }

  return NaN;
}

export default function TournamentHubPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = String(params.id);

  const [tournament, setTournament] = useState<TournamentRow | null>(null);
  const [status, setStatus] = useState("Chargement...");

  const [teamsCount, setTeamsCount] = useState<number>(0);
  const [matchesTotal, setMatchesTotal] = useState<number>(0);
  const [matchesPlayed, setMatchesPlayed] = useState<number>(0);

  const [nextMatch, setNextMatch] = useState<NextMatchRow | null>(null);
  const [lastPlayed, setLastPlayed] = useState<LastPlayedRow | null>(null);

  const [liveMatch, setLiveMatch] = useState<LiveMatchRow | null>(null);
  const [topScorers, setTopScorers] = useState<TopScorerRow[]>([]);
  const [screenUrl, setScreenUrl] = useState<string>("");
  const [publicScreenUrl, setPublicScreenUrl] = useState<string>("");

  const [busyDelete, setBusyDelete] = useState(false);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshEverySec, setRefreshEverySec] = useState(15);

  const progressPct = useMemo(() => {
    if (!matchesTotal) return 0;
    return Math.round((matchesPlayed / matchesTotal) * 100);
  }, [matchesPlayed, matchesTotal]);

  const loadAll = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      router.push("/login");
      return;
    }

    setStatus("Chargement...");

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const adminUrl = `${origin}/dashboard/tournaments/${tournamentId}/screen`;
    const publicUrl = `${origin}/tournaments/${tournamentId}/public/screen`;

    setScreenUrl(adminUrl);
    setPublicScreenUrl(publicUrl);

    const { data: tData, error: tErr } = await supabase
      .from("tournaments")
      .select("id,title,created_at,match_duration_min,rotation_duration_min,format,category,challenge_id")
      .eq("id", tournamentId)
      .single();

    if (tErr) {
      setStatus("Erreur tournoi: " + tErr.message);
      return;
    }

    const tRow = (tData ?? null) as any as TournamentRow;
    setTournament(tRow);

    const matchDur = Number(tRow.match_duration_min ?? 0);
    const rotDur = Number(tRow.rotation_duration_min ?? 0);
    const slotMinutes = Math.max(0, matchDur + rotDur);
    const slotMs = slotMinutes * 60_000;

    const [
      teamsRes,
      matchesTotalRes,
      matchesPlayedRes,
      nextMatchRes,
      lastPlayedRes,
    ] = await Promise.all([
      supabase
        .from("teams")
        .select("*", { count: "exact", head: true })
        .eq("tournament_id", tournamentId),

      supabase
        .from("matches")
        .select("*", { count: "exact", head: true })
        .eq("tournament_id", tournamentId),

      supabase
        .from("matches")
        .select("*", { count: "exact", head: true })
        .eq("tournament_id", tournamentId)
        .eq("status", "played"),

      supabase
        .from("matches")
        .select(
          "id,start_time,field_idx,status,home:home_team_id(name),away:away_team_id(name)"
        )
        .eq("tournament_id", tournamentId)
        .neq("status", "played")
        .order("start_time", { ascending: true })
        .order("field_idx", { ascending: true })
        .limit(1),

      supabase
        .from("matches")
        .select(
          "id,start_time,field_idx,status,home_score,away_score,home:home_team_id(name),away:away_team_id(name)"
        )
        .eq("tournament_id", tournamentId)
        .eq("status", "played")
        .order("start_time", { ascending: false })
        .order("field_idx", { ascending: false })
        .limit(1),
    ]);

    if (teamsRes.error) {
      setStatus("Erreur teams: " + teamsRes.error.message);
      return;
    }
    if (matchesTotalRes.error) {
      setStatus("Erreur matches: " + matchesTotalRes.error.message);
      return;
    }
    if (matchesPlayedRes.error) {
      setStatus("Erreur matches played: " + matchesPlayedRes.error.message);
      return;
    }

    setTeamsCount(teamsRes.count ?? 0);
    setMatchesTotal(matchesTotalRes.count ?? 0);
    setMatchesPlayed(matchesPlayedRes.count ?? 0);

    const nm = (nextMatchRes.data ?? [])[0] as any as NextMatchRow | undefined;
    setNextMatch(nm ?? null);

    const lp = (lastPlayedRes.data ?? [])[0] as any as LastPlayedRow | undefined;
    setLastPlayed(lp ?? null);

    const { data: liveCandidates, error: liveErr } = await supabase
      .from("matches")
      .select(
        "id,start_time,field_idx,status,home_score,away_score,home:home_team_id(name),away:away_team_id(name)"
      )
      .eq("tournament_id", tournamentId)
      .neq("status", "played")
      .order("start_time", { ascending: true })
      .limit(200);

    if (!liveErr) {
      const now = Date.now();
      const candidates = (liveCandidates ?? []).map((m: any) => m as LiveMatchRow);

      const live = candidates.find((m) => {
        const st = parseMsLoose(m.start_time);
        if (Number.isNaN(st)) return false;
        if (slotMs <= 0) return false;
        const et = st + slotMs;
        return st <= now && now < et;
      });

      setLiveMatch(live ?? null);
    } else {
      setLiveMatch(null);
    }

    const { data: playedMatches, error: playedListErr } = await supabase
      .from("matches")
      .select("id")
      .eq("tournament_id", tournamentId)
      .eq("status", "played");

    if (!playedListErr) {
      const playedIds = (playedMatches ?? []).map((r: any) => r.id);

      if (playedIds.length === 0) {
        setTopScorers([]);
      } else {
        const { data: goalsEvents, error: goalsErr } = await supabase
          .from("match_events")
          .select(
            "id,match_id,event_type,player:player_id(id,first_name,last_name,jersey_number,team:team_id(name))"
          )
          .in("match_id", playedIds)
          .eq("event_type", "goal");

        if (!goalsErr) {
          const counter = new Map<string, TopScorerRow>();

          for (const e of goalsEvents ?? []) {
            const p = (e as any).player;
            if (!p?.id) continue;

            const key = String(p.id);
            const current = counter.get(key);

            const row: TopScorerRow = current ?? {
              player_id: key,
              first_name: p.first_name ?? null,
              last_name: p.last_name ?? null,
              jersey_number: p.jersey_number ?? null,
              team_name: p.team?.name ?? null,
              goals: 0,
            };

            row.goals += 1;
            counter.set(key, row);
          }

          const arr = Array.from(counter.values());
          arr.sort((a, b) => {
            if (b.goals !== a.goals) return b.goals - a.goals;
            return fullName(a.first_name, a.last_name).localeCompare(
              fullName(b.first_name, b.last_name)
            );
          });

          setTopScorers(arr.slice(0, 3));
        } else {
          setTopScorers([]);
        }
      }
    } else {
      setTopScorers([]);
    }

    setStatus("");
  }, [router, tournamentId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!autoRefresh) return;

    const sec = Math.max(5, Number(refreshEverySec) || 15);
    const id = setInterval(() => {
      loadAll();
    }, sec * 1000);

    return () => clearInterval(id);
  }, [autoRefresh, refreshEverySec, loadAll]);

  async function deleteTournamentCascade() {
    if (!tournament) return;

    const ok = window.confirm(
      `Supprimer définitivement le tournoi "${tournament.title ?? "Sans titre"}" ?\n\n⚠️ Cela supprimera aussi: équipes, joueurs, matchs, événements.`
    );
    if (!ok) return;

    setBusyDelete(true);
    setStatus("");

    const { data: mData, error: mErr } = await supabase
      .from("matches")
      .select("id")
      .eq("tournament_id", tournamentId);

    if (mErr) {
      setStatus("Erreur lecture matches: " + mErr.message);
      setBusyDelete(false);
      return;
    }

    const matchIds = (mData ?? []).map((m: any) => m.id);

    if (matchIds.length > 0) {
      const { error: eErr } = await supabase
        .from("match_events")
        .delete()
        .in("match_id", matchIds);

      if (eErr) {
        setStatus("Erreur suppression événements: " + eErr.message);
        setBusyDelete(false);
        return;
      }
    }

    const { error: delMatchesErr } = await supabase
      .from("matches")
      .delete()
      .eq("tournament_id", tournamentId);

    if (delMatchesErr) {
      setStatus("Erreur suppression matches: " + delMatchesErr.message);
      setBusyDelete(false);
      return;
    }

    const { error: delPlayersErr } = await supabase
      .from("players")
      .delete()
      .eq("tournament_id", tournamentId);

    if (delPlayersErr) {
      setStatus("Erreur suppression joueurs: " + delPlayersErr.message);
      setBusyDelete(false);
      return;
    }

    const { error: delTeamsErr } = await supabase
      .from("teams")
      .delete()
      .eq("tournament_id", tournamentId);

    if (delTeamsErr) {
      setStatus("Erreur suppression équipes: " + delTeamsErr.message);
      setBusyDelete(false);
      return;
    }

    const { error: delTournamentErr } = await supabase
      .from("tournaments")
      .delete()
      .eq("id", tournamentId);

    if (delTournamentErr) {
      setStatus("Erreur suppression tournoi: " + delTournamentErr.message);
      setBusyDelete(false);
      return;
    }

    setBusyDelete(false);
    router.push("/dashboard/tournaments");
  }

  function go(path: string) {
    router.push(`/dashboard/tournaments/${tournamentId}/${path}`);
  }

  if (!tournament) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="max-w-5xl mx-auto bg-white rounded-xl shadow p-6">
          {status}
        </div>
      </main>
    );
  }

  const qrImg =
    publicScreenUrl
      ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${safeUrlEncode(
          publicScreenUrl
        )}`
      : "";

  const slotLabel = (() => {
    const md = tournament.match_duration_min ?? 0;
    const rd = tournament.rotation_duration_min ?? 0;
    return `${md} min + ${rd} min`;
  })();

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-6 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">{tournament.title ?? "Tournoi"}</h1>
            <p className="text-sm text-gray-500">
              ID: <span className="font-mono text-xs">{tournamentId}</span>
            </p>
            {tournament.created_at && (
              <p className="text-xs text-gray-400 mt-1">
                Créé le {prettyDateTime(tournament.created_at)}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-1">
              Durées (slot): {slotLabel} (utilisé pour “Match en cours”)
            </p>
            {status && <p className="text-sm text-amber-700 mt-2">{status}</p>}
          </div>

          <div className="flex gap-2 flex-wrap justify-end items-center">
            <button
              onClick={() => router.push("/dashboard/tournaments")}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              ← Mes tournois
            </button>

            <button
              onClick={() => loadAll()}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
              title="Rafraîchir"
            >
              🔄 Rafraîchir
            </button>

            <div className="flex items-center gap-2 bg-gray-100 px-3 py-2 rounded-lg">
              <span className="text-xs text-gray-600">Auto</span>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              <span className="text-xs text-gray-600">toutes</span>
              <input
                type="number"
                min={5}
                className="w-16 bg-white border border-gray-200 rounded px-2 py-1 text-sm"
                value={refreshEverySec}
                onChange={(e) => setRefreshEverySec(Number(e.target.value))}
              />
              <span className="text-xs text-gray-600">sec</span>
            </div>

            <button
              onClick={() => go("screen")}
              className="bg-black text-white px-4 py-2 rounded-lg hover:bg-gray-900 transition"
              title="Mode écran géant admin"
            >
              🎥 Écran géant
            </button>

            <a
              href={publicScreenUrl}
              target="_blank"
              rel="noreferrer"
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
              title="Écran public mobile"
            >
              📱 Écran public
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="bg-white rounded-xl shadow p-5">
            <div className="text-sm text-gray-500">Match en cours</div>
            {liveMatch ? (
              <div className="mt-2">
                <div className="inline-flex items-center gap-2 text-xs font-semibold px-2 py-1 rounded bg-red-100 text-red-700">
                  🔴 LIVE
                  <span className="text-gray-500">{hhmmFromIso(liveMatch.start_time)}</span>
                </div>

                <div className="mt-3 text-lg font-bold">
                  {liveMatch.home?.name ?? "Équipe A"}{" "}
                  <span className="mx-2">
                    {liveMatch.home_score ?? 0} - {liveMatch.away_score ?? 0}
                  </span>{" "}
                  {liveMatch.away?.name ?? "Équipe B"}
                </div>

                <div className="text-sm text-gray-600 mt-1">
                  🟩 Terrain {liveMatch.field_idx}
                </div>

                <button
                  onClick={() =>
                    router.push(
                      `/dashboard/tournaments/${tournamentId}/matches/${liveMatch.id}`
                    )
                  }
                  className="mt-3 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm"
                >
                  Ouvrir le match
                </button>

                <p className="mt-2 text-xs text-gray-400">
                  Live calculé via start_time + (match + rotation).
                </p>
              </div>
            ) : (
              <div className="mt-2 text-gray-600">Aucun match détecté en cours.</div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow p-5">
            <div className="text-sm text-gray-500">Top 3 buteurs</div>
            {topScorers.length === 0 ? (
              <div className="mt-2 text-gray-600">Pas de buts sur matchs validés.</div>
            ) : (
              <div className="mt-3 space-y-2">
                {topScorers.map((p, idx) => (
                  <div
                    key={p.player_id}
                    className="flex items-center justify-between border rounded-lg px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center font-bold">
                        {idx + 1}
                      </div>
                      <div>
                        <div className="font-semibold">
                          ⚽️ {fullName(p.first_name, p.last_name)}{" "}
                          <span className="text-gray-500 text-sm">
                            {p.jersey_number != null ? `#${p.jersey_number}` : ""}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">{p.team_name ?? "Équipe"}</div>
                      </div>
                    </div>
                    <div className="text-lg font-extrabold">{p.goals}</div>
                  </div>
                ))}
                <div className="text-xs text-gray-400">
                  Calcul: events “goal” des matchs validés.
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow p-5">
            <div className="text-sm text-gray-500">QR code Écran public</div>
            {publicScreenUrl ? (
              <div className="mt-3 flex items-center gap-4">
                <img
                  src={qrImg}
                  alt="QR code écran public"
                  className="w-[220px] h-[220px] border rounded-lg"
                />
                <div className="text-sm">
                  <div className="font-semibold">Scanne pour ouvrir</div>
                  <div className="text-gray-600 mt-1">Version publique smartphone</div>
                  <div className="mt-2">
                    <a
                      href={publicScreenUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-700 underline break-all"
                    >
                      {publicScreenUrl}
                    </a>
                  </div>
                  <p className="mt-2 text-xs text-gray-400">
                    QR généré sans librairie npm.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-2 text-gray-600">URL non disponible.</div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="bg-white rounded-xl shadow p-5">
            <div className="text-sm text-gray-500">Équipes</div>
            <div className="mt-1 text-3xl font-extrabold">{teamsCount}</div>
            <div className="mt-2 text-xs text-gray-400">Nombre d’équipes inscrites.</div>
          </div>

          <div className="bg-white rounded-xl shadow p-5">
            <div className="text-sm text-gray-500">Matchs</div>
            <div className="mt-1 text-3xl font-extrabold">
              {matchesPlayed} / {matchesTotal}
            </div>
            <div className="mt-2">
              <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-2 bg-green-600" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="text-xs text-gray-400 mt-2">{progressPct}% validés</div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow p-5">
            <div className="text-sm text-gray-500">Prochain match</div>
            {nextMatch ? (
              <div className="mt-2">
                <div className="text-lg font-bold">
                  {nextMatch.home?.name ?? "Équipe A"} vs {nextMatch.away?.name ?? "Équipe B"}
                </div>
                <div className="text-sm text-gray-600 mt-1">
                  ⏱️ {hhmmFromIso(nextMatch.start_time)} · 🟩 Terrain {nextMatch.field_idx}
                </div>
                <button
                  onClick={() =>
                    router.push(`/dashboard/tournaments/${tournamentId}/matches/${nextMatch.id}`)
                  }
                  className="mt-3 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition text-sm"
                >
                  Ouvrir le match
                </button>
              </div>
            ) : (
              <div className="mt-2 text-gray-600">Aucun match à venir.</div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold">Dernier résultat</h2>
            {lastPlayed ? (
              <div className="text-sm text-gray-700 mt-1">
                <span className="font-semibold">{hhmmFromIso(lastPlayed.start_time)}</span> · Terrain{" "}
                {lastPlayed.field_idx} ·{" "}
                <span className="font-semibold">{lastPlayed.home?.name ?? "A"}</span>{" "}
                {lastPlayed.home_score ?? 0} - {lastPlayed.away_score ?? 0}{" "}
                <span className="font-semibold">{lastPlayed.away?.name ?? "B"}</span>
              </div>
            ) : (
              <div className="text-sm text-gray-600 mt-1">Aucun match validé pour l’instant.</div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => go("matches")}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              ⚽️ Matchs
            </button>
            <button
              onClick={() => go("results")}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              🧾 Résultats
            </button>
          </div>
        </div>

        {tournament?.format === "michel_clipet" && (
          <div className="bg-gradient-to-r from-red-600 to-slate-900 text-white rounded-xl shadow p-6 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide">Challenge Michel Clipet {tournament.category ? `· ${tournament.category}` : ""}</div>
              <div className="text-xl font-extrabold">Pilotage M1 → M55</div>
              <div className="text-sm text-white/80">Classement 8/4/2 + buts, phase 2 et tirs au but.</div>
            </div>
            <div className="flex gap-2">
              {tournament.challenge_id && <button onClick={() => router.push(`/dashboard/challenges/${tournament.challenge_id}`)} className="bg-white/15 px-4 py-2 rounded-lg">Challenge global</button>}
              <button onClick={() => go("clipet")} className="bg-white text-slate-900 px-4 py-2 rounded-lg font-bold">Ouvrir le pilotage</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <button
            onClick={() => go("schedule")}
            className="bg-white rounded-xl shadow p-5 text-left hover:bg-slate-50 transition"
          >
            <div className="text-2xl">🗓️</div>
            <div className="mt-2 font-semibold">Planning</div>
            <div className="text-sm text-gray-500">Voir les créneaux et la grille horaire.</div>
          </button>

          <button
            onClick={() => go("matches")}
            className="bg-white rounded-xl shadow p-5 text-left hover:bg-slate-50 transition"
          >
            <div className="text-2xl">⚽️</div>
            <div className="mt-2 font-semibold">Matchs</div>
            <div className="text-sm text-gray-500">Saisir score, valider, détails match.</div>
          </button>

          <button
            onClick={() => go("results")}
            className="bg-white rounded-xl shadow p-5 text-left hover:bg-slate-50 transition"
          >
            <div className="text-2xl">🧾</div>
            <div className="mt-2 font-semibold">Résultats</div>
            <div className="text-sm text-gray-500">Scores validés + événements (sans MVP).</div>
          </button>

          <button
            onClick={() => go("standings")}
            className="bg-white rounded-xl shadow p-5 text-left hover:bg-slate-50 transition"
          >
            <div className="text-2xl">🏆</div>
            <div className="mt-2 font-semibold">Classement</div>
            <div className="text-sm text-gray-500">Points, buts, diff. sur matchs validés.</div>
          </button>

          <button
            onClick={() => go("stats")}
            className="bg-white rounded-xl shadow p-5 text-left hover:bg-slate-50 transition"
          >
            <div className="text-2xl">📊</div>
            <div className="mt-2 font-semibold">Stats joueurs</div>
            <div className="text-sm text-gray-500">Buteurs, passeurs, cartons (validés).</div>
          </button>

          <button
            onClick={() => go("teams")}
            className="bg-white rounded-xl shadow p-5 text-left hover:bg-slate-50 transition"
          >
            <div className="text-2xl">👥</div>
            <div className="mt-2 font-semibold">Équipes</div>
            <div className="text-sm text-gray-500">Feuilles, joueurs, présence.</div>
          </button>
        </div>

        <div className="bg-white rounded-xl shadow p-6 flex items-center justify-between gap-3 flex-wrap border border-red-200">
          <div>
            <h2 className="font-semibold text-red-700">Zone sensible</h2>
            <p className="text-sm text-gray-600">À utiliser uniquement si le tournoi est terminé.</p>
          </div>

          <button
            onClick={deleteTournamentCascade}
            disabled={busyDelete}
            className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition disabled:opacity-50"
          >
            {busyDelete ? "Suppression..." : "🗑️ Supprimer le tournoi"}
          </button>
        </div>
      </div>
    </main>
  );
}