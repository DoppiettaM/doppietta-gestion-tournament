"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../../../lib/supabaseClient";

type Pause = { from: string; to: string };

type Tournament = {
  id: string;
  title: string;

  tournament_date: string | null;

  min_teams: number | null;
  max_teams: number | null;

  start_time: string; // time
  end_time: string; // time
  match_duration_min: number;
  rotation_duration_min: number;

  num_fields: number;
  field_names: string[];

  pauses: any;
  field_pauses: any;
};

type Team = { id: string; name: string };

type MatchRow = {
  id: string;
  start_time: string;
  field_idx: number;
  home_team_id: string;
  away_team_id: string;
  home: { name: string } | null;
  away: { name: string } | null;
};

function normHHMM(t: string) {
  return (t ?? "").slice(0, 5);
}
function timeToMin(t: string) {
  const hhmm = normHHMM(t);
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
function minToTime(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

/** Round Robin (méthode du cercle) */
function roundRobinPairs(teamIds: string[]) {
  const ids = [...teamIds];
  if (ids.length % 2 === 1) ids.push("__BYE__");

  const n = ids.length;
  const rounds = n - 1;
  const half = n / 2;

  const pairs: Array<{ a: string; b: string; round: number }> = [];
  let arr = [...ids];

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== "__BYE__" && b !== "__BYE__") pairs.push({ a, b, round: r + 1 });
    }
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop() as string);
    arr = [fixed, ...rest];
  }

  return pairs;
}

export default function SchedulePage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = String(params.id);

  const [t, setT] = useState<Tournament | null>(null);
  const [status, setStatus] = useState("Chargement...");
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [teamsCount, setTeamsCount] = useState<number>(0);

  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const slotMinutes = useMemo(() => {
    if (!t) return 15;
    return Math.max(1, (t.match_duration_min ?? 12) + (t.rotation_duration_min ?? 0));
  }, [t]);

  const fieldNames = useMemo(() => {
    if (!t) return [];
    const count = t.num_fields ?? 1;
    return t.field_names ?? Array.from({ length: count }, (_, i) => `Terrain ${i + 1}`);
  }, [t]);

  // Pauses: global + except + per-field
  const pauseModel = useMemo(() => {
    if (!t) {
      return {
        globalPauses: [] as Pause[],
        exceptPause: null as null | { from: string; to: string; exceptFields: number[] },
        fieldPausesObj: {} as Record<string, Pause[]>,
      };
    }

    const pausesArr = Array.isArray(t.pauses) ? t.pauses : [];
    const pTournament = pausesArr.find((p: any) => p?.type === "tournament");
    const pExcept = pausesArr.find((p: any) => p?.type === "tournament_except");

    const globalPauses: Pause[] = [];
    if (pTournament?.from && pTournament?.to) globalPauses.push({ from: pTournament.from, to: pTournament.to });

    const exceptPause =
      pExcept?.from && pExcept?.to
        ? {
            from: pExcept.from,
            to: pExcept.to,
            exceptFields: Array.isArray(pExcept.exceptFields) ? pExcept.exceptFields : [],
          }
        : null;

    const rawFp = t.field_pauses && typeof t.field_pauses === "object" ? t.field_pauses : {};
    const fieldPausesObj: Record<string, Pause[]> = {};
    for (const k of Object.keys(rawFp)) {
      fieldPausesObj[k] = Array.isArray(rawFp[k])
        ? rawFp[k].filter((x: any) => x?.from && x?.to).map((x: any) => ({ from: x.from, to: x.to }))
        : [];
    }

    return { globalPauses, exceptPause, fieldPausesObj };
  }, [t]);

  function isPaused(fieldIdx: number, startHHMM: string) {
    if (!t) return false;

    const start = timeToMin(startHHMM);
    const end = start + slotMinutes;

    if (pauseModel.globalPauses.some((p) => overlaps(start, end, timeToMin(p.from), timeToMin(p.to)))) return true;

    if (pauseModel.exceptPause) {
      const inExcept = overlaps(start, end, timeToMin(pauseModel.exceptPause.from), timeToMin(pauseModel.exceptPause.to));
      if (inExcept) {
        const allowed = pauseModel.exceptPause.exceptFields.includes(fieldIdx);
        if (!allowed) return true;
      }
    }

    const fp = pauseModel.fieldPausesObj[String(fieldIdx)] ?? [];
    if (fp.some((p) => overlaps(start, end, timeToMin(p.from), timeToMin(p.to)))) return true;

    return false;
  }

  const timeline = useMemo(() => {
    if (!t) return [];
    const start = timeToMin(t.start_time || "09:00");
    const end = timeToMin(t.end_time || "18:00");

    const times: string[] = [];
    for (let cur = start; cur + slotMinutes <= end; cur += slotMinutes) times.push(minToTime(cur));
    return times;
  }, [t, slotMinutes]);

  const matchMap = useMemo(() => {
    const m = new Map<string, MatchRow>();
    for (const match of matches) {
      const key = `${normHHMM(match.start_time)}|${match.field_idx}`;
      m.set(key, match);
    }
    return m;
  }, [matches]);

  const totalPlayableSlots = useMemo(() => {
    if (!t) return 0;

    const fieldCount = t.num_fields ?? 1;
    const startMin = timeToMin(t.start_time || "09:00");
    const endMin = timeToMin(t.end_time || "18:00");

    let count = 0;
    for (let cur = startMin; cur + slotMinutes <= endMin; cur += slotMinutes) {
      const hhmm = minToTime(cur);
      for (let f = 1; f <= fieldCount; f++) if (!isPaused(f, hhmm)) count++;
    }
    return count;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, slotMinutes, pauseModel]);

  const neededMatches = useMemo(() => {
    if (!teamsCount || teamsCount < 2) return 0;
    return (teamsCount * (teamsCount - 1)) / 2;
  }, [teamsCount]);

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return router.push("/login");

      const { data, error } = await supabase
        .from("tournaments")
        .select(
          "id,title,tournament_date,min_teams,max_teams,start_time,end_time,match_duration_min,rotation_duration_min,num_fields,field_names,pauses,field_pauses"
        )
        .eq("id", tournamentId)
        .single();

      if (error) return setStatus("Erreur: " + error.message);

      setT(data as Tournament);
      setStatus("");

      await refreshMatches();
      await refreshTeamsCount();
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, tournamentId]);

  async function refreshTeamsCount() {
    const { count } = await supabase
      .from("teams")
      .select("id", { count: "exact", head: true })
      .eq("tournament_id", tournamentId);

    setTeamsCount(count ?? 0);
  }

  async function refreshMatches() {
    const { data, error } = await supabase
      .from("matches")
      .select("id,start_time,field_idx,home_team_id,away_team_id,home:home_team_id(name),away:away_team_id(name)")
      .eq("tournament_id", tournamentId)
      .order("start_time", { ascending: true })
      .order("field_idx", { ascending: true });

    if (!error) setMatches((data ?? []) as any);
  }

  async function generateMatches() {
    if (!t) return;

    setStatus("Génération des matchs...");

    const { data: teamRows, error: teamErr } = await supabase
      .from("teams")
      .select("id,name")
      .eq("tournament_id", tournamentId)
      .order("created_at", { ascending: true });

    if (teamErr) return setStatus("Erreur teams: " + teamErr.message);

    const teams = (teamRows ?? []) as Team[];
    setTeamsCount(teams.length);

    // ✅ B2: contrôles min/max + capacité
    const minT = t.min_teams ?? 2;
    const maxT = t.max_teams ?? 24;

    if (teams.length < minT) {
      setStatus(`Pas assez d'équipes: ${teams.length}/${minT} minimum.`);
      return;
    }
    if (teams.length > maxT) {
      setStatus(`Trop d'équipes: ${teams.length}/${maxT} maximum.`);
      return;
    }

    const mustMatches = (teams.length * (teams.length - 1)) / 2;
    if (mustMatches > totalPlayableSlots) {
      setStatus(
        `Planning impossible: ${mustMatches} matchs requis, mais seulement ${totalPlayableSlots} créneaux jouables (horaires/pauses/terrains).`
      );
      return;
    }

    // On supprime les matchs existants
    const { error: delErr } = await supabase.from("matches").delete().eq("tournament_id", tournamentId);
    if (delErr) return setStatus("Erreur delete matches: " + delErr.message);

    const pairs = roundRobinPairs(teams.map((x) => x.id));

    // Créneaux jouables: on remplit “tous terrains à chaque temps” sauf pauses
    const allSlots: Array<{ start: string; fieldIdx: number; slotIndex: number }> = [];
    let idx = 0;

    const fieldCount = t.num_fields ?? 1;
    const startMin = timeToMin(t.start_time || "09:00");
    const endMin = timeToMin(t.end_time || "18:00");

    const slotsByField: Record<number, string[]> = {};
    for (let f = 1; f <= fieldCount; f++) slotsByField[f] = [];

    for (let cur = startMin; cur + slotMinutes <= endMin; cur += slotMinutes) {
      const hhmm = minToTime(cur);
      for (let f = 1; f <= fieldCount; f++) if (!isPaused(f, hhmm)) slotsByField[f].push(hhmm);
    }

    const maxSlotsPerField = Math.max(...Object.values(slotsByField).map((arr) => arr.length), 0);
    for (let s = 0; s < maxSlotsPerField; s++) {
      for (let f = 1; f <= fieldCount; f++) {
        const start = slotsByField[f][s];
        if (start) allSlots.push({ start, fieldIdx: f, slotIndex: idx++ });
      }
    }

    // Placement “fair”
    const playedCount = new Map<string, number>();
    const lastSlotIndex = new Map<string, number>();
    const busyAtTime = new Map<string, Set<string>>();

    for (const tm of teams) {
      playedCount.set(tm.id, 0);
      lastSlotIndex.set(tm.id, -9999);
    }

    const scheduled: Array<{
      tournament_id: string;
      home_team_id: string;
      away_team_id: string;
      field_idx: number;
      start_time: string;
    }> = [];

    function equityPenaltyAfter(a: string, b: string) {
      const ca = playedCount.get(a) ?? 0;
      const cb = playedCount.get(b) ?? 0;
      const minPlayed = Math.min(...Array.from(playedCount.values()));
      const maxAfter = Math.max(ca + 1, cb + 1, ...Array.from(playedCount.values()));
      return Math.max(0, maxAfter - (minPlayed + 2)) * 10; // “idéalement personne n’a +2”
    }

    let pairPtr = 0;

    for (const slot of allSlots) {
      if (pairPtr >= pairs.length) break;

      const timeKey = slot.start;
      if (!busyAtTime.has(timeKey)) busyAtTime.set(timeKey, new Set());
      const busySet = busyAtTime.get(timeKey)!;

      let bestIndex = -1;
      let bestScore = Number.POSITIVE_INFINITY;

      const window = 140;
      const endPtr = Math.min(pairs.length, pairPtr + window);

      for (let i = pairPtr; i < endPtr; i++) {
        const { a, b } = pairs[i];

        // jamais une équipe 2 fois au même horaire
        if (busySet.has(a) || busySet.has(b)) continue;

        // repos: idéalement au moins 1 slot entre deux matchs (slotIndex diff >=2)
        const la = lastSlotIndex.get(a) ?? -9999;
        const lb = lastSlotIndex.get(b) ?? -9999;
        const restOk = slot.slotIndex - la >= 2 && slot.slotIndex - lb >= 2;
        const restPenalty = restOk ? 0 : 6;

        // équité
        const eqPenalty = equityPenaltyAfter(a, b);

        // favoriser ceux qui ont moins joué
        const ca = playedCount.get(a) ?? 0;
        const cb = playedCount.get(b) ?? 0;

        const score = restPenalty + eqPenalty + (ca + cb);

        if (score < bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }

      if (bestIndex === -1) continue;

      [pairs[pairPtr], pairs[bestIndex]] = [pairs[bestIndex], pairs[pairPtr]];
      const chosen = pairs[pairPtr];

      scheduled.push({
        tournament_id: tournamentId,
        home_team_id: chosen.a,
        away_team_id: chosen.b,
        field_idx: slot.fieldIdx,
        start_time: slot.start,
      });

      busySet.add(chosen.a);
      busySet.add(chosen.b);

      playedCount.set(chosen.a, (playedCount.get(chosen.a) ?? 0) + 1);
      playedCount.set(chosen.b, (playedCount.get(chosen.b) ?? 0) + 1);
      lastSlotIndex.set(chosen.a, slot.slotIndex);
      lastSlotIndex.set(chosen.b, slot.slotIndex);

      pairPtr++;
    }

    // Insert par chunk
    const chunkSize = 200;
    for (let i = 0; i < scheduled.length; i += chunkSize) {
      const chunk = scheduled.slice(i, i + chunkSize);
      const { error } = await supabase.from("matches").insert(chunk);
      if (error) return setStatus("Erreur insert matches: " + error.message);
    }

    setStatus(`OK ✅ Matchs générés: ${scheduled.length}.`);
    await refreshMatches();
  }

  if (!t) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="max-w-3xl mx-auto bg-white rounded-xl shadow p-6">{status}</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-6 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Planning: {t.title}</h1>
            <p className="text-sm text-gray-500">
              {t.tournament_date ? `Date: ${t.tournament_date} · ` : ""}
              {normHHMM(t.start_time)} → {normHHMM(t.end_time)} · Slot = {slotMinutes} min · Terrains {t.num_fields}
            </p>
            <p className="text-sm text-gray-500">
              Équipes: {teamsCount} (min {t.min_teams ?? 2} / max {t.max_teams ?? 24}) · Matchs requis (RR):{" "}
              {neededMatches} · Créneaux jouables: {totalPlayableSlots} · Matchs programmés: {matches.length}
            </p>
          </div>

          <div className="flex gap-2 flex-wrap justify-end">
            <button
              onClick={() => router.push(`/dashboard/tournaments/${t.id}/matches`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Gestion des matchs
            </button>
            <button
              onClick={() => router.push(`/dashboard/tournaments/${t.id}/teams`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Équipes
            </button>
            <button
              onClick={() => router.push(`/dashboard/tournaments`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              Mes tournois
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-700 font-semibold">Affichage:</span>

            <button
              onClick={() => setViewMode("grid")}
              className={`px-3 py-2 rounded-lg text-sm transition ${
                viewMode === "grid" ? "bg-blue-600 text-white" : "bg-gray-100 hover:bg-gray-200"
              }`}
            >
              Grille
            </button>

            <button
              onClick={() => setViewMode("list")}
              className={`px-3 py-2 rounded-lg text-sm transition ${
                viewMode === "list" ? "bg-blue-600 text-white" : "bg-gray-100 hover:bg-gray-200"
              }`}
            >
              Liste
            </button>
          </div>

          <button
            onClick={generateMatches}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
          >
            Générer les matchs
          </button>
        </div>

        {status && <div className="bg-white rounded-xl shadow p-4 text-gray-700">{status}</div>}

        {viewMode === "grid" && (
          <div className="bg-white rounded-xl shadow p-6 overflow-auto">
            <div className="min-w-[900px]">
              <table className="w-full border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="sticky top-0 bg-white z-10 text-left p-3 border-b text-sm text-gray-600 w-28">
                      Heure
                    </th>
                    {fieldNames.map((fname, idx) => (
                      <th key={idx} className="sticky top-0 bg-white z-10 text-left p-3 border-b text-sm text-gray-600">
                        {fname}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {timeline.map((hhmm) => (
                    <tr key={hhmm} className="align-top">
                      <td className="p-3 border-b text-sm text-gray-700 font-semibold bg-slate-50">{hhmm}</td>

                      {fieldNames.map((_, i) => {
                        const fieldIdx = i + 1;
                        const key = `${hhmm}|${fieldIdx}`;
                        const match = matchMap.get(key);
                        const paused = isPaused(fieldIdx, hhmm);

                        if (match) {
                          return (
                            <td key={key} className="p-2 border-b">
                              <div className="rounded-lg border bg-green-50 p-3">
                                <div className="text-xs text-green-700 font-semibold mb-1">MATCH</div>
                                <div className="font-semibold text-gray-900">{match.home?.name ?? "Équipe A"}</div>
                                <div className="text-sm text-gray-700">vs</div>
                                <div className="font-semibold text-gray-900">{match.away?.name ?? "Équipe B"}</div>
                              </div>
                            </td>
                          );
                        }

                        if (paused) {
                          return (
                            <td key={key} className="p-2 border-b">
                              <div className="rounded-lg border bg-red-50 p-3">
                                <div className="text-xs text-red-700 font-semibold">PAUSE</div>
                                <div className="text-sm text-red-800">Terrain indisponible</div>
                              </div>
                            </td>
                          );
                        }

                        return (
                          <td key={key} className="p-2 border-b">
                            <div className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-400">—</div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {viewMode === "list" && (
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold mb-3">Matchs programmés</h2>

            {matches.length === 0 ? (
              <div className="text-gray-500">Aucun match. Clique “Générer les matchs”.</div>
            ) : (
              <div className="space-y-2">
                {matches.map((m) => (
                  <div key={m.id} className="border rounded-lg p-3 flex items-center justify-between gap-3">
                    <div className="text-sm text-gray-600">
                      <strong>{normHHMM(m.start_time)}</strong> · {fieldNames[(m.field_idx ?? 1) - 1] ?? `Terrain ${m.field_idx}`}
                    </div>
                    <div className="font-semibold">
                      {(m.home?.name ?? "Équipe A")} vs {(m.away?.name ?? "Équipe B")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}