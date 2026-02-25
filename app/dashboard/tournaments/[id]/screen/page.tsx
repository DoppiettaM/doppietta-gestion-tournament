"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../../lib/supabaseClient";

type TournamentRow = {
  id: string;
  title: string | null;
  match_duration_min: number | null;
  rotation_duration_min: number | null;
  num_fields: number | null;
  field_names: string[] | null;

  // ✅ Poules
  format: string | null; // "round_robin" | "groups_round_robin"
  group_count: number | null; // 1..8
  group_names: string[] | null;
};

type MatchRow = {
  id: string;
  start_time: string;
  field_idx: number;
  status: string; // scheduled | played
  home_score: number | null;
  away_score: number | null;

  home_team_id?: string;
  away_team_id?: string;

  // ✅ join teams => group_idx
  home: { name: string | null; group_idx: number | null } | null;
  away: { name: string | null; group_idx: number | null } | null;
};

type StatRow = {
  player_id: string;
  goals: number;
  player: { first_name: string | null; last_name: string | null } | null;
  team: { name: string | null } | null;
};

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
    return new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  return "--:--";
}

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

function playerLabel(p: StatRow["player"]) {
  const fn = (p?.first_name ?? "").trim();
  const ln = (p?.last_name ?? "").trim();
  const full = `${fn} ${ln}`.trim();
  return full || "Joueur";
}

function teamLabel(t: { name: string | null } | null) {
  const s = (t?.name ?? "").trim();
  return s || "Équipe";
}

function oneLineName(raw: string, maxChars = 22) {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "Équipe";
  if (s.length <= maxChars) return s;
  const cut = Math.max(1, maxChars - 1);
  return s.slice(0, cut).replace(/\s+$/g, "") + "…";
}

function isLive(m: MatchRow, slotMs: number) {
  if ((m.status ?? "").toLowerCase() === "played") return false;
  const st = parseMsLoose(m.start_time);
  if (Number.isNaN(st)) return false;
  if (slotMs <= 0) return false;
  const et = st + slotMs;
  const now = Date.now();
  return st <= now && now < et;
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export default function ScreenPage() {
  const params = useParams();
  const tournamentId = String(params.id);

  const [status, setStatus] = useState("Chargement...");
  const [tournament, setTournament] = useState<TournamentRow | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [topScorers, setTopScorers] = useState<StatRow[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const refreshTimerRef = useRef<number | null>(null);

  const slotMs = useMemo(() => {
    const md = Number(tournament?.match_duration_min ?? 0);
    const rd = Number(tournament?.rotation_duration_min ?? 0);
    return Math.max(0, md + rd) * 60_000;
  }, [tournament]);

  const numFields = useMemo(() => {
    const n = Number(tournament?.num_fields ?? 0);
    if (n > 0) return n;
    let max = 0;
    for (const m of matches) max = Math.max(max, Number(m.field_idx ?? 0));
    return Math.max(1, max);
  }, [tournament, matches]);

  // ✅ UI compact selon nb terrains (objectif: 5 terrains sans scroll horizontal)
  const ui = useMemo(() => {
    const f = numFields;

    if (f >= 6) {
      return {
        headerTitle: "text-2xl",
        headerSub: "text-[11px]",
        tablePad: "p-3",
        thPad: "px-2 py-2",
        timeBig: "text-2xl",
        cellPad: "p-2",
        teamText: "text-[12px]",
        vsText: "text-[10px]",
        scoreText: "text-xl",
        footerText: "text-[10px]",
        nameMax: 14,
        cellMinH: "min-h-[86px]",
      };
    }
    if (f === 5) {
      return {
        headerTitle: "text-3xl",
        headerSub: "text-[11px]",
        tablePad: "p-3",
        thPad: "px-2 py-2",
        timeBig: "text-3xl",
        cellPad: "p-2",
        teamText: "text-[13px]",
        vsText: "text-[10px]",
        scoreText: "text-2xl",
        footerText: "text-[11px]",
        nameMax: 16,
        cellMinH: "min-h-[94px]",
      };
    }
    if (f === 4) {
      return {
        headerTitle: "text-4xl",
        headerSub: "text-xs",
        tablePad: "p-4",
        thPad: "px-3 py-3",
        timeBig: "text-4xl",
        cellPad: "p-3",
        teamText: "text-sm",
        vsText: "text-[11px]",
        scoreText: "text-3xl",
        footerText: "text-xs",
        nameMax: 20,
        cellMinH: "min-h-[110px]",
      };
    }
    return {
      headerTitle: "text-4xl",
      headerSub: "text-xs",
      tablePad: "p-5",
      thPad: "px-4 py-4",
      timeBig: "text-4xl",
      cellPad: "p-4",
      teamText: "text-lg",
      vsText: "text-[11px]",
      scoreText: "text-4xl",
      footerText: "text-xs",
      nameMax: 22,
      cellMinH: "min-h-[130px]",
    };
  }, [numFields]);

  const fieldNameOnly = useMemo(() => {
    const names = (tournament?.field_names ?? []).map((x) => String(x ?? "").trim());
    return (fieldIdx: number) => {
      const idx = Math.max(1, Number(fieldIdx || 1));
      const custom = names[idx - 1] ?? "";
      return custom || String(idx);
    };
  }, [tournament]);

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

  function groupLabelFromMatch(m: MatchRow) {
    if (!showGroups) return "";
    const g = Number(m.home?.group_idx ?? m.away?.group_idx ?? 1);
    const idx = clampInt(g, 1, Math.max(1, groupNames.length || 1));
    return groupNames[idx - 1] ?? `Poule ${idx}`;
  }

  function statusLabel(m: MatchRow) {
    const played = (m.status ?? "").toLowerCase() === "played";
    const live = isLive(m, slotMs);
    if (live) return "🔴 En cours";
    if (played) return "✅ Validé";
    return "⏳ À venir";
  }

  const times = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of matches) {
      const t = timeHHMM(m.start_time);
      const ms = parseMsLoose(m.start_time);
      const val = Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms;
      const cur = map.get(t);
      if (cur == null || val < cur) map.set(t, val);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([k]) => k);
  }, [matches]);

  const matchByCell = useMemo(() => {
    const map = new Map<string, MatchRow>();
    for (const m of matches) {
      const t = timeHHMM(m.start_time);
      const f = Number(m.field_idx);
      map.set(`${t}__${f}`, m);
    }
    return map;
  }, [matches]);

  const liveMatches = useMemo(() => {
    return matches
      .filter((m) => isLive(m, slotMs))
      .sort((a, b) => (a.field_idx ?? 0) - (b.field_idx ?? 0));
  }, [matches, slotMs]);

  const { doneTimes, upcomingTimes } = useMemo(() => {
    const byTime = new Map<string, { allPlayed: boolean; idx: number }>();
    const idx = new Map(times.map((t, i) => [t, i]));

    for (const t of times) byTime.set(t, { allPlayed: true, idx: idx.get(t) ?? 0 });

    for (const m of matches) {
      const t = timeHHMM(m.start_time);
      if (!byTime.has(t)) byTime.set(t, { allPlayed: true, idx: idx.get(t) ?? 0 });
      const s = byTime.get(t)!;
      const played = (m.status ?? "").toLowerCase() === "played";
      if (!played) s.allPlayed = false;
    }

    const done: string[] = [];
    const up: string[] = [];
    for (const [t, s] of byTime.entries()) {
      if (s.allPlayed) done.push(t);
      else up.push(t);
    }

    const sortBy = (a: string, b: string) => (idx.get(a) ?? 0) - (idx.get(b) ?? 0);
    done.sort(sortBy);
    up.sort(sortBy);

    return { doneTimes: done, upcomingTimes: up };
  }, [matches, times]);

  async function loadTournament() {
    const { data, error } = await supabase
      .from("tournaments")
      .select("id,title,match_duration_min,rotation_duration_min,num_fields,field_names,format,group_count,group_names")
      .eq("id", tournamentId)
      .single();

    if (error) {
      setStatus("Erreur tournoi: " + error.message);
      return null;
    }
    setTournament((data ?? null) as any);
    return data as any as TournamentRow;
  }

  async function loadMatches() {
    const { data, error } = await supabase
      .from("matches")
      .select(
        "id,start_time,field_idx,status,home_score,away_score,home_team_id,away_team_id,home:home_team_id(name,group_idx),away:away_team_id(name,group_idx)"
      )
      .eq("tournament_id", tournamentId)
      .order("start_time", { ascending: true })
      .order("field_idx", { ascending: true });

    if (error) {
      setStatus("Erreur matches: " + error.message);
      return null;
    }
    setMatches((data ?? []) as any);
    return (data ?? []) as any as MatchRow[];
  }

  async function loadTopScorers() {
    const { data: eData, error: eErr } = await supabase
      .from("match_events")
      .select(
        "id,player_id,match_id,type,match:match_id(status),player:player_id(first_name,last_name),team:team_id(name)"
      )
      .eq("tournament_id", tournamentId)
      .eq("type", "goal");

    if (eErr) {
      setTopScorers([]);
      return;
    }

    const goals = (eData ?? []).filter((r: any) => (r?.match?.status ?? "").toLowerCase() === "played");
    const byPlayer = new Map<string, StatRow>();

    for (const r of goals as any[]) {
      const pid = String(r.player_id ?? "");
      if (!pid) continue;
      const cur = byPlayer.get(pid);
      if (!cur) {
        byPlayer.set(pid, {
          player_id: pid,
          goals: 1,
          player: r.player ?? null,
          team: r.team ?? null,
        });
      } else {
        cur.goals += 1;
      }
    }

    const top = Array.from(byPlayer.values())
      .sort((a, b) => b.goals - a.goals)
      .slice(0, 3);

    setTopScorers(top);
  }

  async function loadAll() {
    setStatus("Chargement...");
    await loadTournament();
    await loadMatches();
    await loadTopScorers();
    setStatus("");
  }

  function scheduleRefresh(_reason: string) {
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => loadAll(), 250);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => loadMatches(), 10_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, tournamentId]);

  useEffect(() => {
    const onFocus = () => scheduleRefresh("focus");
    const onVis = () => {
      if (document.visibilityState === "visible") scheduleRefresh("visible");
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  useEffect(() => {
    const ch = supabase
      .channel(`screen_${tournamentId}`)
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "match_events", filter: `tournament_id=eq.${tournamentId}` },
        () => scheduleRefresh("events_changed")
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentId]);

  function Cell({ m }: { m: MatchRow }) {
    const played = (m.status ?? "").toLowerCase() === "played";
    const live = isLive(m, slotMs);

    // ✅ contrastes + lisibilité
    const skin = played
      ? "bg-green-50 border-green-300 text-slate-900"
      : live
      ? "bg-red-50 border-red-300 text-slate-900"
      : "bg-white border-slate-200 text-slate-900";

    const homeName = oneLineName(teamLabel(m.home), ui.nameMax);
    const awayName = oneLineName(teamLabel(m.away), ui.nameMax);

    const gLabel = groupLabelFromMatch(m);
    const sLabel = statusLabel(m);

    return (
      <div className={`rounded-2xl border shadow-sm ${skin} ${ui.cellMinH} ${ui.cellPad} flex flex-col`}>
        {/* Header mini : heure + terrain (petit, discret, mais utile) */}
        <div className="flex items-center justify-between gap-2">
          <div className="text-[10px] font-extrabold text-slate-500 truncate">⏱️ {timeHHMM(m.start_time)}</div>
          <div className="text-[10px] font-extrabold text-slate-500 truncate">🏟️ {fieldNameOnly(m.field_idx)}</div>
        </div>

        {/* Centre : équipes/vs/score */}
        <div className="flex-1 flex flex-col items-center justify-center text-center px-1">
          <div className={`w-full font-extrabold truncate leading-none ${ui.teamText}`}>{homeName}</div>
          <div className={`font-extrabold text-slate-400 leading-none ${ui.vsText}`}>vs</div>
          <div className={`w-full font-extrabold truncate leading-none ${ui.teamText}`}>{awayName}</div>

          <div className="mt-1 flex items-center justify-center gap-2">
            <div className={`font-extrabold tabular-nums ${ui.scoreText}`}>{m.home_score ?? "–"}</div>
            <div className={`font-extrabold text-slate-300 ${ui.scoreText}`}>-</div>
            <div className={`font-extrabold tabular-nums ${ui.scoreText}`}>{m.away_score ?? "–"}</div>
          </div>
        </div>

        {/* Footer : poule bas gauche / statut bas droite */}
        <div className="flex items-end justify-between gap-2">
          <div className={`font-extrabold text-slate-600 ${ui.footerText} truncate`}>
            {showGroups ? `📍 ${gLabel}` : ""}
          </div>
          <div className={`font-extrabold ${ui.footerText} whitespace-nowrap text-slate-700`}>{sLabel}</div>
        </div>
      </div>
    );
  }

  const PubSlot = ({ label }: { label: string }) => (
    <div className="bg-white/5 border border-white/10 rounded-3xl p-3 h-[90px] md:h-[110px] flex items-center justify-center text-slate-300">
      <div className="text-center">
        <div className="text-sm font-semibold">{label}</div>
        <div className="text-xs text-slate-400 mt-1">Image partenaire (à brancher)</div>
      </div>
    </div>
  );

  const LiveCompact = () => (
    <div className="bg-white/5 border border-white/10 rounded-3xl p-4">
      <div className="text-sm text-slate-300 font-semibold mb-2">🔴 Matchs en cours (compact)</div>
      {liveMatches.length === 0 ? (
        <div className="text-slate-300 text-sm">Aucun match live.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {liveMatches.map((m) => (
            <div key={m.id} className="bg-black/20 border border-white/10 rounded-2xl p-3">
              <div className="text-xs text-slate-300 flex items-center justify-between">
                <span>⏱️ {timeHHMM(m.start_time)}</span>
                <span>🏟️ {fieldNameOnly(m.field_idx)}</span>
              </div>
              <div className="mt-1 font-extrabold">
                {teamLabel(m.home)}{" "}
                <span className="text-slate-400 mx-2">
                  {m.home_score ?? "–"} - {m.away_score ?? "–"}
                </span>{" "}
                {teamLabel(m.away)}
              </div>
              {showGroups && (
                <div className="mt-1 text-xs text-slate-400 font-semibold truncate">📍 {groupLabelFromMatch(m)}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  function renderPlanningSection(title: string, timesList: string[]) {
    if (timesList.length === 0) return null;

    return (
      <div className={`bg-white/5 border border-white/10 rounded-3xl ${ui.tablePad}`}>
        <div className="font-extrabold mb-3 text-lg text-slate-100">{title}</div>

        {/* ✅ pas de min-width => pas de scroll horizontal */}
        <div className="w-full overflow-hidden">
          <table className="w-full table-fixed border-separate border-spacing-2">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="bg-slate-950 border border-white/10 rounded-3xl text-left w-[92px]">
                  <div className={`px-3 py-3 ${ui.headerSub} text-slate-300`}>Heure</div>
                </th>

                {Array.from({ length: numFields }, (_, i) => i + 1).map((fieldIdx) => (
                  <th key={`field__${fieldIdx}`} className="bg-slate-950 border border-white/10 rounded-3xl text-left">
                    <div className={`${ui.thPad}`}>
                      <div className={`${ui.headerSub} text-slate-300`}>Terrain</div>
                      <div className="font-extrabold truncate">{fieldNameOnly(fieldIdx)}</div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {timesList.map((t) => (
                <tr key={`${title}__${t}`}>
                  <td className="bg-slate-950 border border-white/10 rounded-3xl align-top">
                    <div className="px-3 py-4">
                      <div className={`${ui.headerSub} text-slate-300`}>Créneau</div>
                      <div className={`${ui.timeBig} font-extrabold leading-none`}>⏱️ {t}</div>
                    </div>
                  </td>

                  {Array.from({ length: numFields }, (_, i) => i + 1).map((field) => {
                    const m = matchByCell.get(`${t}__${field}`);
                    return (
                      <td key={`${title}__${t}__${field}`} className="align-top">
                        {m ? (
                          <Cell m={m} />
                        ) : (
                          <div className={`rounded-2xl border border-white/10 bg-white/5 ${ui.cellMinH} p-4 text-center`}>
                            <div className="text-white/25 font-extrabold">—</div>
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
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs text-slate-300">Doppietta Gestion Tournament</div>
            <h1 className={`${ui.headerTitle} font-extrabold tracking-tight`}>{tournament?.title ?? "Écran géant"}</h1>
            {status && <div className="text-amber-300 mt-2 text-sm">{status}</div>}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => loadAll()}
              className="text-[11px] bg-white/10 hover:bg-white/20 transition px-3 py-2 rounded-xl font-semibold"
              title="Rafraîchir"
            >
              🔄 Rafraîchir
            </button>

            <button
              onClick={() => setAutoRefresh((v) => !v)}
              className="text-[11px] bg-white/10 hover:bg-white/20 transition px-3 py-2 rounded-xl font-semibold"
              title="Auto-refresh"
            >
              {autoRefresh ? "⏱️ Auto ON" : "⏸️ Auto OFF"}
            </button>

            <button
              onClick={() => {
                const el = document.documentElement;
                if (!document.fullscreenElement) el.requestFullscreen?.();
                else document.exitFullscreen?.();
              }}
              className="text-[11px] bg-white/10 hover:bg-white/20 transition px-3 py-2 rounded-xl font-semibold"
              title="Plein écran"
            >
              ⛶ Plein écran
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PubSlot label="Partenaire #1" />
          <PubSlot label="Partenaire #2" />
        </div>

        <LiveCompact />

        {renderPlanningSection("Matchs à venir", upcomingTimes)}
        {renderPlanningSection("Matchs déjà réalisés", doneTimes)}

        <div className="bg-white/5 border border-white/10 rounded-3xl p-5">
          <div className="text-sm text-slate-300 font-semibold mb-3">🥅 Top 3 buteurs</div>
          {topScorers.length === 0 ? (
            <div className="text-slate-300">Aucune stat.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {topScorers.map((s, idx) => (
                <div key={s.player_id} className="bg-black/20 border border-white/10 rounded-2xl p-4">
                  <div className="text-xs text-slate-300 font-semibold">#{idx + 1}</div>
                  <div className="mt-1 font-extrabold">{playerLabel(s.player)}</div>
                  <div className="text-xs text-slate-400 mt-1">{s.team?.name ?? ""}</div>
                  <div className="mt-3 text-3xl font-extrabold tabular-nums">⚽ {s.goals}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white/5 border border-white/10 rounded-3xl p-5 text-slate-300">
            <div className="text-sm font-semibold">📣 Publicité #3</div>
            <div className="text-xs mt-1">Zone réservée</div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-3xl p-5 text-slate-300">
            <div className="text-sm font-semibold">📣 Publicité #4</div>
            <div className="text-xs mt-1">Zone réservée</div>
          </div>
        </div>
      </div>
    </main>
  );
}