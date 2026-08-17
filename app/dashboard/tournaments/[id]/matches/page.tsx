"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type TournamentRow = {
  id: string;
  match_duration_min: number | null;
  rotation_duration_min: number | null;
  num_fields: number | null;
  field_names: string[] | null;
  format?: string | null;
};

type MatchRow = {
  id: string;
  start_time: string; // ISO ou HH:MM...
  field_idx: number;
  status: string; // "scheduled" | "played" | ...
  home_score: number | null;
  away_score: number | null;
  home_team_id: string;
  away_team_id: string;
  home: { name: string } | null;
  away: { name: string } | null;
  match_number?: number | null;
  phase?: string | null;
  stage?: string | null;
  penalty_home?: number | null;
  penalty_away?: number | null;
  winner_team_id?: string | null;
};

function parseMsLoose(v: string | null) {
  if (!v) return NaN;

  const ms = Date.parse(v);
  if (!Number.isNaN(ms)) return ms;

  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v.trim());
  if (m) {
    const hh = Math.min(23, Math.max(0, Number(m[1])));
    const mm = Math.min(59, Math.max(0, Number(m[2])));
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    return d.getTime();
  }

  return NaN;
}

function timeHHMM(v: string | null) {
  if (!v) return "--:--";

  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v.trim());
  if (m) {
    const hh = String(Math.min(23, Math.max(0, Number(m[1])))).padStart(2, "0");
    const mm = String(Math.min(59, Math.max(0, Number(m[2])))).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  const ms = Date.parse(v);
  if (!Number.isNaN(ms)) {
    return new Date(ms).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return "--:--";
}

function isPlayed(m: MatchRow) {
  return (m.status ?? "").toLowerCase() === "played";
}

function isLive(m: MatchRow, slotMs: number) {
  if (isPlayed(m)) return false;

  const now = Date.now();
  const st = parseMsLoose(m.start_time);
  if (Number.isNaN(st)) return false;

  const et = st + slotMs;
  if (slotMs <= 0 || Number.isNaN(et) || et === st) return false;

  return st <= now && now < et;
}

function teamShort(name: string | null | undefined) {
  const s = (name ?? "").trim();
  if (!s) return "Équipe";
  return s.length > 16 ? s.slice(0, 15) + "…" : s;
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export default function MatchesPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = String(params.id);

  const [status, setStatus] = useState("Chargement...");

  const [tournament, setTournament] = useState<TournamentRow | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);

  // ✅ scores éditables (resync à chaque refreshMatches)
  const [editScores, setEditScores] = useState<Record<string, { home: string; away: string; ph: string; pa: string }>>({});

  const [showPlayed, setShowPlayed] = useState(true);

  const slotMs = useMemo(() => {
    const md = Number(tournament?.match_duration_min ?? 0);
    const rd = Number(tournament?.rotation_duration_min ?? 0);
    return Math.max(0, md + rd) * 60_000;
  }, [tournament]);

  const numFields = useMemo(() => {
    const nf = Number(tournament?.num_fields ?? 1);
    return clampInt(nf, 1, 24);
  }, [tournament]);

  const fieldLabels = useMemo(() => {
    const raw = Array.isArray(tournament?.field_names) ? tournament!.field_names! : [];
    const out: string[] = [];
    for (let i = 1; i <= numFields; i++) {
      const nm = String(raw[i - 1] ?? "").trim();
      out.push(nm || `Terrain ${i}`);
    }
    return out;
  }, [tournament, numFields]);

  // --------- DATA LOAD / SYNC ---------

  async function refreshTournament() {
    const { data, error } = await supabase
      .from("tournaments")
      .select("id,match_duration_min,rotation_duration_min,num_fields,field_names,format")
      .eq("id", tournamentId)
      .single();

    if (error) {
      setStatus("Erreur tournoi: " + error.message);
      return null;
    }

    setTournament((data ?? null) as any);
    return data as any as TournamentRow;
  }

  async function refreshMatches() {
    const { data, error } = await supabase
      .from("matches")
      .select(
        "id,start_time,field_idx,status,home_score,away_score,home_team_id,away_team_id,home:home_team_id(name),away:away_team_id(name),match_number,phase,stage,penalty_home,penalty_away,winner_team_id"
      )
      .eq("tournament_id", tournamentId)
      .order("start_time", { ascending: true })
      .order("field_idx", { ascending: true });

    if (error) {
      setStatus("Erreur matches: " + error.message);
      return;
    }

    const arr = (data ?? []) as any as MatchRow[];
    setMatches(arr);

    // ✅ resync editScores depuis DB
    const next: Record<string, { home: string; away: string; ph: string; pa: string }> = {};
    for (const m of arr) {
      next[m.id] = {
        home: m.home_score != null ? String(m.home_score) : "",
        away: m.away_score != null ? String(m.away_score) : "",
        ph: m.penalty_home != null ? String(m.penalty_home) : "",
        pa: m.penalty_away != null ? String(m.penalty_away) : "",
      };
    }
    setEditScores(next);
  }

  async function refreshAll() {
    setStatus("Chargement...");
    await refreshTournament();
    await refreshMatches();
    setStatus("");
  }

  // Load initial
  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return router.push("/login");
      await refreshAll();
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, tournamentId]);

  // ✅ Auto-refresh: focus + visibility + polling léger
  const pollRef = useRef<number | null>(null);

  // ✅ anti-spam refresh (si plusieurs events realtime arrivent d’un coup)
  const refreshTimerRef = useRef<number | null>(null);

  function scheduleRefresh(reason: string) {
    // console.log("scheduleRefresh:", reason);
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshAll(); // tournoi + matchs (noms terrains, nb terrains, etc.)
    }, 250);
  }

  useEffect(() => {
    const onFocus = () => scheduleRefresh("focus");
    const onVis = () => {
      if (document.visibilityState === "visible") scheduleRefresh("visible");
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    // polling toutes les 10s (tu peux monter à 20s si tu veux)
    pollRef.current = window.setInterval(() => {
      refreshMatches(); // matches suffisent la plupart du temps
    }, 10_000);

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

  // ✅ Realtime Supabase: MAJ immédiate quand planning/tournoi change
  useEffect(() => {
    // Important: certains projets Supabase exigent d’avoir activé Realtime sur les tables.
    // Si Realtime n’est pas actif, le polling + focus/visibility continuent de faire le job.

    const ch = supabase
      .channel(`matches_${tournamentId}`)
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

  // --------- ACTIONS ---------

  async function saveScore(matchId: string) {
    const v = editScores[matchId];
    if (!v) return;

    const hs = v.home.trim() === "" ? null : Number(v.home);
    const as = v.away.trim() === "" ? null : Number(v.away);

    if (hs != null && Number.isNaN(hs)) return alert("Score domicile invalide");
    if (as != null && Number.isNaN(as)) return alert("Score extérieur invalide");

    const ph = v.ph.trim() === "" ? null : Number(v.ph);
    const pa = v.pa.trim() === "" ? null : Number(v.pa);
    const winner_team_id = hs != null && as != null && hs === as && ph != null && pa != null && ph !== pa
      ? (ph > pa ? matches.find((m) => m.id === matchId)?.home_team_id : matches.find((m) => m.id === matchId)?.away_team_id)
      : null;
    const { error } = await supabase.from("matches").update({ home_score: hs, away_score: as, penalty_home: ph, penalty_away: pa, winner_team_id }).eq("id", matchId);

    if (error) {
      alert("Erreur update score: " + error.message);
      return;
    }

    await refreshMatches();
  }

  async function toggleValidation(match: MatchRow) {
    const played = isPlayed(match);
    if (played) {
      const { error } = await supabase.from("matches").update({ status: "scheduled" }).eq("id", match.id);
      if (error) return alert("Erreur validation: " + error.message);
      return refreshMatches();
    }

    const v = editScores[match.id] ?? { home: "", away: "", ph: "", pa: "" };
    const hs = v.home.trim() === "" ? null : Number(v.home);
    const as = v.away.trim() === "" ? null : Number(v.away);
    const ph = v.ph.trim() === "" ? null : Number(v.ph);
    const pa = v.pa.trim() === "" ? null : Number(v.pa);
    if (hs == null || as == null || Number.isNaN(hs) || Number.isNaN(as)) return alert("Renseigne le score avant de valider.");

    const shootout = tournament?.format === "michel_clipet" && [46, 47, 54, 55].includes(Number(match.match_number));
    let winner_team_id: string | null = null;
    if (hs > as) winner_team_id = match.home_team_id;
    if (as > hs) winner_team_id = match.away_team_id;
    if (shootout && hs === as) {
      if (ph == null || pa == null || Number.isNaN(ph) || Number.isNaN(pa) || ph === pa) {
        return alert("Égalité : renseigne les tirs au but avec un vainqueur.");
      }
      winner_team_id = ph > pa ? match.home_team_id : match.away_team_id;
    }

    const { error } = await supabase.from("matches").update({
      home_score: hs, away_score: as, penalty_home: ph, penalty_away: pa, winner_team_id, status: "played", played_at: new Date().toISOString(),
    }).eq("id", match.id);
    if (error) return alert("Erreur validation: " + error.message);
    await refreshMatches();
  }

  // --------- GRILLE (heures x terrains) ---------

  const filteredMatches = useMemo(() => {
    if (showPlayed) return matches;
    return matches.filter((m) => !isPlayed(m));
  }, [matches, showPlayed]);

  const times = useMemo(() => {
    const map = new Map<string, number>(); // HH:MM -> ms pour tri
    for (const m of filteredMatches) {
      const t = timeHHMM(m.start_time);
      const ms = parseMsLoose(m.start_time);
      const value = Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms;
      const cur = map.get(t);
      if (cur == null || value < cur) map.set(t, value);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([k]) => k);
  }, [filteredMatches]);

  const matchByCell = useMemo(() => {
    const map = new Map<string, MatchRow>();
    for (const m of filteredMatches) {
      const t = timeHHMM(m.start_time);
      const f = Number(m.field_idx);
      const key = `${t}__${f}`;
      // si doublon, on garde le premier pour éviter de faire exploser la grille
      if (!map.has(key)) map.set(key, m);
    }
    return map;
  }, [filteredMatches]);

  function Cell({ m }: { m: MatchRow }) {
    const live = isLive(m, slotMs);
    const played = isPlayed(m);
    const t = timeHHMM(m.start_time);

    const hs = editScores[m.id]?.home ?? "";
    const as = editScores[m.id]?.away ?? "";
    const ph = editScores[m.id]?.ph ?? "";
    const pa = editScores[m.id]?.pa ?? "";
    const shootout = tournament?.format === "michel_clipet" && [46,47,54,55].includes(Number(m.match_number));

    return (
      <div
        className={`rounded-xl border p-3 select-none ${
          live ? "bg-red-50 border-red-200" : played ? "bg-green-50 border-green-200" : "bg-white"
        }`}
      >
        <button
          onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/matches/${m.id}`)}
          className="w-full text-left"
          title="Ouvrir détails"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[12px] text-gray-500 font-semibold">{m.match_number ? `M${m.match_number} · ` : ""}⏱️ {t}</div>
              <div className="font-extrabold text-[13px] truncate">
                {teamShort(m.home?.name)} <span className="text-gray-400">vs</span> {teamShort(m.away?.name)}
              </div>

              <div className="mt-1 flex flex-wrap gap-1">
                {live && (
                  <span className="text-[11px] font-bold px-2 py-[2px] rounded bg-red-100 text-red-700">
                    🔴 LIVE
                  </span>
                )}
                {played && (
                  <span className="text-[11px] font-bold px-2 py-[2px] rounded bg-green-100 text-green-700">
                    ✅ Validé
                  </span>
                )}
                {!played && !live && (
                  <span className="text-[11px] font-bold px-2 py-[2px] rounded bg-blue-100 text-blue-700">
                    ⏳ À jouer
                  </span>
                )}
              </div>

              {t === "--:--" && (
                <div className="mt-1 text-[11px] text-amber-700">
                  start_time brut: <span className="font-mono">{String(m.start_time)}</span>
                </div>
              )}
            </div>

            <div className="shrink-0 text-xs text-gray-500 font-semibold">🟩 {m.field_idx}</div>
          </div>
        </button>

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <input
              value={hs}
              onChange={(e) =>
                setEditScores((prev) => ({
                  ...prev,
                  [m.id]: { ...(prev[m.id] ?? { home: "", away: "", ph: "", pa: "" }), home: e.target.value },
                }))
              }
              className="w-12 border rounded-lg px-2 py-2 text-center text-xl font-extrabold"
              placeholder="-"
            />
            <span className="text-xl font-extrabold text-gray-500">-</span>
            <input
              value={as}
              onChange={(e) =>
                setEditScores((prev) => ({
                  ...prev,
                  [m.id]: { ...(prev[m.id] ?? { home: "", away: "", ph: "", pa: "" }), away: e.target.value },
                }))
              }
              className="w-12 border rounded-lg px-2 py-2 text-center text-xl font-extrabold"
              placeholder="-"
            />
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => saveScore(m.id)}
              className="bg-gray-200 px-2 py-2 rounded-lg hover:bg-gray-300 transition text-sm"
              title="Enregistrer"
            >
              💾
            </button>

            <button
              onClick={() => toggleValidation(m)}
              className={`px-2 py-2 rounded-lg transition text-sm ${
                played ? "bg-yellow-200 hover:bg-yellow-300" : "bg-green-600 text-white hover:bg-green-700"
              }`}
              title={played ? "Dévalider" : "Valider"}
            >
              {played ? "↩️" : "✅"}
            </button>

            <button
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/matches/${m.id}`)}
              className="bg-blue-600 text-white px-2 py-2 rounded-lg hover:bg-blue-700 transition text-sm"
              title="Détails"
            >
              🔎
            </button>
          </div>
        </div>
        {shootout && (
          <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2">
            <div className="text-[11px] font-bold text-amber-800 mb-1">Tirs au but (uniquement si égalité)</div>
            <div className="flex items-center gap-2">
              <input value={ph} onChange={(e)=>setEditScores(prev=>({...prev,[m.id]:{...(prev[m.id]??{home:"",away:"",ph:"",pa:""}),ph:e.target.value}}))} className="w-12 border rounded px-2 py-1 text-center" placeholder="TAB" />
              <span>-</span>
              <input value={pa} onChange={(e)=>setEditScores(prev=>({...prev,[m.id]:{...(prev[m.id]??{home:"",away:"",ph:"",pa:""}),pa:e.target.value}}))} className="w-12 border rounded px-2 py-1 text-center" placeholder="TAB" />
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-6 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Gestion des matchs</h1>
            <p className="text-sm text-gray-500">
              Lignes = heures, colonnes = terrains. Les noms des terrains viennent des paramètres du tournoi.
            </p>
            {status && <p className="text-sm text-amber-700 mt-2">{status}</p>}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              ← Retour
            </button>

            <button
              onClick={() => refreshAll()}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
              title="Rafraîchir (tournoi + matchs)"
            >
              🔄
            </button>

            <label className="flex items-center gap-2 bg-gray-100 px-3 py-2 rounded-lg text-sm">
              <input type="checkbox" checked={showPlayed} onChange={(e) => setShowPlayed(e.target.checked)} />
              Afficher validés
            </label>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-4">
          {times.length === 0 ? (
            <div className="p-4 text-gray-600">Aucun match à afficher.</div>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-[1000px] w-full border-separate border-spacing-3">
                <thead className="sticky top-0 z-10">
                  <tr>
                    <th className="sticky left-0 z-20 bg-white border rounded-xl px-4 py-3 text-left">
                      <div className="text-sm text-gray-500">Heure</div>
                      <div className="text-lg font-extrabold">Début</div>
                    </th>

                    {fieldLabels.map((label, idx) => (
                      <th key={idx} className="bg-white border rounded-xl px-4 py-3 text-left">
                        <div className="text-xs text-gray-500">Terrain</div>
                        <div className="text-lg font-extrabold">{label}</div>
                        <div className="text-xs text-gray-400">#{idx + 1}</div>
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {times.map((t) => (
                    <tr key={t}>
                      <td className="sticky left-0 z-10 bg-white border rounded-xl px-4 py-4 align-top">
                        <div className="text-xs text-gray-500">Créneau</div>
                        <div className="text-3xl font-extrabold">⏱️ {t}</div>
                        <div className="text-xs text-gray-500 mt-1">Début des matchs</div>
                      </td>

                      {Array.from({ length: numFields }, (_, i) => i + 1).map((field) => {
                        const key = `${t}__${field}`;
                        const m = matchByCell.get(key);

                        return (
                          <td key={key} className="align-top">
                            {m ? (
                              <Cell m={m} />
                            ) : (
                              <div className="rounded-xl border bg-slate-50 p-6 text-center text-gray-300 font-extrabold">
                                —
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-gray-400 mt-3 px-2">
            LIVE = start_time + (durée match + rotation). Les scores affichés viennent de la DB à chaque refresh.
          </p>
        </div>
      </div>
    </main>
  );
}
