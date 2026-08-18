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

  format: string | null;
  group_count: number | null;
  group_names: string[] | null;

  screen_partner_top_1_url: string | null;
  screen_partner_top_2_url: string | null;
  screen_partner_bottom_1_url: string | null;
  screen_partner_bottom_2_url: string | null;
};

type MatchRow = {
  id: string;
  start_time: string;
  field_idx: number;
  status: string;
  home_score: number | null;
  away_score: number | null;

  home_team_id?: string;
  away_team_id?: string;

  home: { name: string | null; group_idx: number | null } | null;
  away: { name: string | null; group_idx: number | null } | null;
  match_number: number | null;
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
  const [refByMatch, setRefByMatch] = useState<Record<string,string>>({});
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

  const ui = useMemo(() => {
    const f = numFields;

    if (f >= 6) {
      return {
        headerTitle: "text-2xl md:text-2xl",
        headerSub: "text-[11px]",
        tablePad: "p-2 md:p-3",
        thPad: "px-2 py-2",
        timeBig: "text-xl md:text-2xl",
        cellPad: "p-2",
        teamText: "text-[12px]",
        vsText: "text-[9px]",
        scoreText: "text-lg",
        footerText: "text-[10px]",
        nameMax: 14,
        cellMinH: "min-h-[84px]",
        partnerTopH: "h-[64px] md:h-[78px]",
        partnerBottomH: "h-[70px] md:h-[82px]",
        mobileTimeW: "w-[36px]",
      };
    }
    if (f === 5) {
      return {
        headerTitle: "text-2xl md:text-3xl",
        headerSub: "text-[11px]",
        tablePad: "p-2 md:p-3",
        thPad: "px-2 py-2",
        timeBig: "text-2xl md:text-3xl",
        cellPad: "p-2",
        teamText: "text-[12px] md:text-[13px]",
        vsText: "text-[9px] md:text-[10px]",
        scoreText: "text-xl md:text-2xl",
        footerText: "text-[10px] md:text-[11px]",
        nameMax: 16,
        cellMinH: "min-h-[88px]",
        partnerTopH: "h-[66px] md:h-[82px]",
        partnerBottomH: "h-[72px] md:h-[86px]",
        mobileTimeW: "w-[38px]",
      };
    }
    if (f === 4) {
      return {
        headerTitle: "text-2xl md:text-4xl",
        headerSub: "text-[10px] md:text-xs",
        tablePad: "p-2 md:p-4",
        thPad: "px-2 py-2 md:px-3 md:py-3",
        timeBig: "text-2xl md:text-4xl",
        cellPad: "p-2 md:p-3",
        teamText: "text-[12px] md:text-sm",
        vsText: "text-[9px] md:text-[11px]",
        scoreText: "text-xl md:text-3xl",
        footerText: "text-[10px] md:text-xs",
        nameMax: 18,
        cellMinH: "min-h-[96px]",
        partnerTopH: "h-[72px] md:h-[92px]",
        partnerBottomH: "h-[76px] md:h-[96px]",
        mobileTimeW: "w-[40px]",
      };
    }
    return {
      headerTitle: "text-2xl md:text-4xl",
      headerSub: "text-[10px] md:text-xs",
      tablePad: "p-2 md:p-5",
      thPad: "px-2 py-2 md:px-4 md:py-4",
      timeBig: "text-2xl md:text-4xl",
      cellPad: "p-2 md:p-4",
      teamText: "text-[12px] md:text-lg",
      vsText: "text-[9px] md:text-[11px]",
      scoreText: "text-xl md:text-4xl",
      footerText: "text-[10px] md:text-xs",
      nameMax: 20,
      cellMinH: "min-h-[102px]",
      partnerTopH: "h-[74px] md:h-[104px]",
      partnerBottomH: "h-[80px] md:h-[108px]",
      mobileTimeW: "w-[42px]",
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

  const matchesByTime = useMemo(() => {
    const map = new Map<string, MatchRow[]>();
    for (const m of matches) {
      const t = timeHHMM(m.start_time);
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(m);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => Number(a.field_idx ?? 0) - Number(b.field_idx ?? 0));
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
      .select(
        "id,title,match_duration_min,rotation_duration_min,num_fields,field_names,format,group_count,group_names,screen_partner_top_1_url,screen_partner_top_2_url,screen_partner_bottom_1_url,screen_partner_bottom_2_url"
      )
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
    const [matchRes, refRes] = await Promise.all([
      supabase.from("matches").select("id,start_time,field_idx,status,home_score,away_score,match_number,home_team_id,away_team_id,home:home_team_id(name,group_idx),away:away_team_id(name,group_idx)").eq("tournament_id", tournamentId).order("start_time", { ascending: true }).order("field_idx", { ascending: true }),
      supabase.from("referee_assignments").select("match_id,referee:referee_id(name)").eq("tournament_id", tournamentId)
    ]);
    if (matchRes.error) { setStatus("Erreur matches: " + matchRes.error.message); return null; }
    setMatches((matchRes.data ?? []) as any);
    if (!refRes.error) { const map:Record<string,string>={}; for(const row of refRes.data??[]){const rr:any=row;map[String(rr.match_id)]=rr.referee?.name??"";} setRefByMatch(map); }
    return (matchRes.data ?? []) as any as MatchRow[];
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

  function Cell({ m, compact = false }: { m: MatchRow; compact?: boolean }) {
    const played = (m.status ?? "").toLowerCase() === "played";
    const live = isLive(m, slotMs);

    const skin = played
      ? "bg-green-50 border-green-300 text-slate-900"
      : live
        ? "bg-red-50 border-red-300 text-slate-900"
        : "bg-white border-slate-200 text-slate-900";

    const homeName = oneLineName(teamLabel(m.home), compact ? 13 : ui.nameMax);
    const awayName = oneLineName(teamLabel(m.away), compact ? 13 : ui.nameMax);

    const gLabel = groupLabelFromMatch(m);
    const sLabel = statusLabel(m);

    return (
      <div
        className={[
          "rounded-2xl border shadow-sm flex flex-col",
          skin,
          compact ? "min-h-[82px] p-2" : `${ui.cellMinH} ${ui.cellPad}`,
        ].join(" ")}
      >
        <div className="flex items-center justify-between gap-1">
          <div className={`font-extrabold text-slate-500 truncate ${compact ? "text-[9px]" : "text-[10px]"}`}>
            {m.match_number ? `M${m.match_number} · ` : ""}⏱️ {timeHHMM(m.start_time)}
          </div>
          <div className={`font-extrabold text-slate-500 truncate ${compact ? "text-[9px]" : "text-[10px]"}`}>
            🏟️ {fieldNameOnly(m.field_idx)}
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center text-center px-1">
          <div className={`w-full font-extrabold truncate leading-none ${compact ? "text-[11px]" : ui.teamText}`}>
            {homeName}
          </div>
          <div className={`font-extrabold text-slate-400 leading-none ${compact ? "text-[8px]" : ui.vsText}`}>
            vs
          </div>
          <div className={`w-full font-extrabold truncate leading-none ${compact ? "text-[11px]" : ui.teamText}`}>
            {awayName}
          </div>

          <div className="mt-1 flex items-center justify-center gap-1">
            <div className={`font-extrabold tabular-nums ${compact ? "text-lg" : ui.scoreText}`}>
              {m.home_score ?? "–"}
            </div>
            <div className={`font-extrabold text-slate-300 ${compact ? "text-lg" : ui.scoreText}`}>-</div>
            <div className={`font-extrabold tabular-nums ${compact ? "text-lg" : ui.scoreText}`}>
              {m.away_score ?? "–"}
            </div>
          </div>
        </div>

        <div className="flex items-end justify-between gap-1">
          <div className={`font-extrabold text-slate-600 truncate ${compact ? "text-[8px]" : ui.footerText}`}>
            {refByMatch[m.id] ? `🟨 Arbitre : ${refByMatch[m.id]}` : (showGroups ? `📍 ${gLabel}` : "")}
          </div>
          <div className={`font-extrabold whitespace-nowrap text-slate-700 ${compact ? "text-[8px]" : ui.footerText}`}>
            {sLabel}
          </div>
        </div>
      </div>
    );
  }

  function PartnerSlot({
    url,
    label,
    heightClass,
  }: {
    url: string | null | undefined;
    label: string;
    heightClass: string;
  }) {
    return (
      <div className={`rounded-2xl ${heightClass} overflow-hidden flex items-center justify-center bg-transparent`}>
        {url ? (
          <img
            src={url}
            alt={label}
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-400 p-3 border border-white/10 rounded-2xl bg-white/5">
            <div className="text-center">
              <div className="text-sm font-semibold">{label}</div>
              <div className="text-xs text-slate-500 mt-1">Bannière non renseignée</div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderPlanningSectionDesktop(title: string, timesList: string[]) {
    if (timesList.length === 0) return null;

    return (
      <div className={`hidden md:block bg-white/5 border border-white/10 rounded-3xl ${ui.tablePad}`}>
        <div className="font-extrabold mb-3 text-lg text-slate-100">{title}</div>

        <div className="w-full overflow-hidden">
          <table className="w-full table-fixed border-separate border-spacing-2">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="bg-slate-950 border border-white/10 rounded-3xl text-center w-[140px]">
                  <div className={`px-3 py-3 ${ui.headerSub} text-slate-300 font-extrabold tracking-wide`}>
                    DÉBUT PRÉVISIONNEL DES RENCONTRES
                  </div>
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
                <tr key={`${title}__desktop__${t}`}>
                  <td className="bg-slate-950 border border-white/10 rounded-3xl align-middle">
                    <div className="h-full min-h-[100px] flex items-center justify-center text-center px-3 py-4">
                      <div className={`${ui.timeBig} font-extrabold leading-none`}>⏱️ {t}</div>
                    </div>
                  </td>

                  {Array.from({ length: numFields }, (_, i) => i + 1).map((field) => {
                    const m = matchByCell.get(`${t}__${field}`);
                    return (
                      <td key={`${title}__desktop__${t}__${field}`} className="align-top">
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

  function renderPlanningSectionMobile(title: string, timesList: string[]) {
    if (timesList.length === 0) return null;

    return (
      <div className={`md:hidden bg-white/5 border border-white/10 rounded-3xl ${ui.tablePad}`}>
        <div className="font-extrabold mb-3 text-base text-slate-100">{title}</div>

        <div className="overflow-hidden">
          <table className="w-full border-separate border-spacing-2">
            <thead>
              <tr>
                <th className={`bg-slate-950 border border-white/10 rounded-2xl text-center ${ui.mobileTimeW}`}>
                  <div className="text-[10px] text-slate-300 py-2 font-extrabold">DÉBUT</div>
                </th>
                <th className="bg-slate-950 border border-white/10 rounded-2xl text-left">
                  <div className="px-3 py-2 text-[10px] text-slate-300">Les rencontres</div>
                </th>
              </tr>
            </thead>

            <tbody>
              {timesList.map((t) => {
                const arr = matchesByTime.get(t) ?? [];
                const rows: MatchRow[][] = [];
                for (let i = 0; i < arr.length; i += 2) rows.push(arr.slice(i, i + 2));

                return (
                  <tr key={`${title}__mobile__${t}`}>
                    <td className={`align-top bg-slate-950 border border-white/10 rounded-2xl text-center ${ui.mobileTimeW}`}>
                      <div className="h-full flex items-center justify-center px-1 py-2">
                        <div
                          className="text-[11px] font-extrabold text-slate-200 whitespace-nowrap"
                          style={{
                            writingMode: "vertical-rl",
                            transform: "rotate(180deg)",
                          }}
                        >
                          ⏱️ {t}
                        </div>
                      </div>
                    </td>

                    <td className="align-top">
                      {rows.length > 0 ? (
                        <div className="space-y-2">
                          {rows.map((pair, idx) => (
                            <div key={`${t}__pair__${idx}`} className="grid grid-cols-2 gap-2">
                              {pair.map((m) => (
                                <Cell key={m.id} m={m} compact />
                              ))}
                              {pair.length === 1 && (
                                <div className="rounded-2xl border border-white/10 bg-white/5 min-h-[82px]" />
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-white/10 bg-white/5 min-h-[82px] p-4 text-center">
                          <div className="text-white/25 font-extrabold">—</div>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white p-3 md:p-4">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="flex flex-col md:flex-row items-start justify-between gap-4">
          <div>
            <div className="text-xs text-slate-300">Doppietta Gestion Tournament</div>
            <h1 className={`${ui.headerTitle} font-extrabold tracking-tight`}>
              {tournament?.title ?? "Écran géant"}
            </h1>
            {status && <div className="text-amber-300 mt-2 text-sm">{status}</div>}
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 items-center">
          <PartnerSlot
            url={tournament?.screen_partner_top_1_url}
            label="Partenaire #1"
            heightClass={ui.partnerTopH}
          />
          <PartnerSlot
            url={tournament?.screen_partner_top_2_url}
            label="Partenaire #2"
            heightClass={ui.partnerTopH}
          />
          <PartnerSlot
            url={tournament?.screen_partner_bottom_1_url}
            label="Partenaire #3"
            heightClass={ui.partnerTopH}
          />
        </div>

        {renderPlanningSectionMobile("PROGRAMME DES PROCHAINES RENCONTRES", upcomingTimes)}
        {renderPlanningSectionDesktop("PROGRAMME DES PROCHAINES RENCONTRES", upcomingTimes)}

        {renderPlanningSectionMobile("RENCONTRES RÉALISÉES", doneTimes)}
        {renderPlanningSectionDesktop("RENCONTRES RÉALISÉES", doneTimes)}

        <div className="bg-white/5 border border-white/10 rounded-3xl p-4 md:p-5">
          <div className="text-sm md:text-base text-slate-100 font-extrabold mb-3">
            L’ORGANISATION DE L’ÉVÈNEMENT À UN MESSAGE POUR VOUS !
          </div>

          <div className="w-full rounded-2xl border border-white/10 bg-black/20 min-h-[120px] md:min-h-[140px] px-5 py-6 flex items-center justify-center text-center">
            <div className="text-slate-300 text-sm md:text-base">
              Zone de message libre à paramétrer dans les réglages du tournoi.
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 items-center">
          <PartnerSlot
            url={tournament?.screen_partner_bottom_1_url}
            label="Publicité #1"
            heightClass={ui.partnerBottomH}
          />
          <PartnerSlot
            url={tournament?.screen_partner_bottom_2_url}
            label="Publicité #2"
            heightClass={ui.partnerBottomH}
          />
        </div>
      </div>
    </main>
  );
}