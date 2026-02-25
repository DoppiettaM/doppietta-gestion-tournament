"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

  // ✅ Poules
  format: string | null; // "round_robin" | "groups_round_robin"
  group_count: number | null; // 1..8
  group_names: string[] | null;
};

type Team = { id: string; name: string; group_idx?: number | null };

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
function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
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

/** Mélange alterné des poules: A1,B1,C1,A2,B2,C2,... */
function interleaveByGroups(groups: { groupIdx: number; pairs: Array<{ a: string; b: string; round: number }> }[]) {
  const queues = groups.map((g) => ({ groupIdx: g.groupIdx, q: [...g.pairs] }));
  const out: Array<{ a: string; b: string; groupIdx: number }> = [];

  // ordre: poule 1..N
  queues.sort((x, y) => x.groupIdx - y.groupIdx);

  let madeProgress = true;
  while (madeProgress) {
    madeProgress = false;
    for (const g of queues) {
      const item = g.q.shift();
      if (item) {
        out.push({ a: item.a, b: item.b, groupIdx: g.groupIdx });
        madeProgress = true;
      }
    }
  }

  return out;
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

  // ✅ édition manuelle
  const [editMode, setEditMode] = useState(false);
  const [selectedCell, setSelectedCell] = useState<string | null>(null);
  const originalPositionsRef = useRef<Map<string, { start: string; field: number }>>(new Map());

  const slotMinutes = useMemo(() => {
    if (!t) return 15;
    return Math.max(1, (t.match_duration_min ?? 12) + (t.rotation_duration_min ?? 0));
  }, [t]);

  const fieldNames = useMemo(() => {
    if (!t) return [];
    const count = t.num_fields ?? 1;
    return t.field_names ?? Array.from({ length: count }, (_, i) => `Terrain ${i + 1}`);
  }, [t]);

  const showGroups = useMemo(() => (t?.format ?? "") === "groups_round_robin", [t]);
  const groupCount = useMemo(() => clampInt(Number(t?.group_count ?? 1), 1, 8), [t]);
  const groupNames = useMemo(() => {
    const raw = Array.isArray(t?.group_names) ? (t?.group_names as any[]) : [];
    const out: string[] = [];
    for (let i = 1; i <= groupCount; i++) {
      const s = String(raw[i - 1] ?? "").trim();
      out.push(s || `Poule ${i}`);
    }
    return out;
  }, [t, groupCount]);

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

  const timeIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    timeline.forEach((hhmm, idx) => m.set(hhmm, idx));
    return m;
  }, [timeline]);

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

  // estimation simple (théorique)
  const estimate = useMemo(() => {
    if (!t) return null;

    const startMin = timeToMin(t.start_time || "09:00");
    const endMin = timeToMin(t.end_time || "18:00");
    const slot = Math.max(1, (t.match_duration_min ?? 12) + (t.rotation_duration_min ?? 0));
    const fields = t.num_fields ?? 1;

    const nTeams = teamsCount ?? 0;
    if (nTeams < 2) {
      return {
        needed: 0,
        theoreticalSlotsCount: 0,
        endTheoretical: null as string | null,
        exceedsWindow: false,
        capacityPlayable: totalPlayableSlots,
        slot,
        fields,
      };
    }

    const needed = (nTeams * (nTeams - 1)) / 2;
    const roundsNeeded = Math.ceil(needed / fields);
    const theoreticalEndMin = startMin + roundsNeeded * slot;

    return {
      needed,
      theoreticalSlotsCount: roundsNeeded * fields,
      endTheoretical: minToTime(theoreticalEndMin % (24 * 60)),
      exceedsWindow: theoreticalEndMin > endMin,
      capacityPlayable: totalPlayableSlots,
      slot,
      fields,
    };
  }, [t, teamsCount, totalPlayableSlots]);

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return router.push("/login");

      const { data, error } = await supabase
        .from("tournaments")
        .select(
          "id,title,tournament_date,min_teams,max_teams,start_time,end_time,match_duration_min,rotation_duration_min,num_fields,field_names,pauses,field_pauses,format,group_count,group_names"
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

  function enterEditMode() {
    // snapshot positions
    const snap = new Map<string, { start: string; field: number }>();
    for (const m of matches) snap.set(m.id, { start: normHHMM(m.start_time), field: Number(m.field_idx) });
    originalPositionsRef.current = snap;

    setSelectedCell(null);
    setEditMode(true);
    setStatus("Mode modification manuelle activé. Clique une cellule puis une autre pour échanger (ou déplacer sur une cellule vide).");
  }

  async function cancelEditMode() {
    setEditMode(false);
    setSelectedCell(null);
    setStatus("Annulé.");
    await refreshMatches();
  }

  async function saveManualEdits() {
    const orig = originalPositionsRef.current;
    if (!orig || orig.size === 0) {
      setEditMode(false);
      setStatus("Rien à enregistrer.");
      return;
    }

    // Détecter changements
    const updates: Array<{ id: string; start_time: string; field_idx: number }> = [];
    for (const m of matches) {
      const curStart = normHHMM(m.start_time);
      const curField = Number(m.field_idx);
      const o = orig.get(m.id);
      if (!o) continue;
      if (o.start !== curStart || o.field !== curField) {
        updates.push({ id: m.id, start_time: curStart, field_idx: curField });
      }
    }

    // Validation: pas d’équipe en double sur un même créneau
    const byTime = new Map<string, Set<string>>();
    for (const m of matches) {
      const hhmm = normHHMM(m.start_time);
      if (!byTime.has(hhmm)) byTime.set(hhmm, new Set());
      const set = byTime.get(hhmm)!;
      const a = m.home_team_id;
      const b = m.away_team_id;
      if (set.has(a) || set.has(b)) {
        setStatus(`❌ Invalide: une équipe est présente 2 fois sur le créneau ${hhmm}.`);
        return;
      }
      set.add(a);
      set.add(b);
    }

    if (updates.length === 0) {
      setStatus("Aucun changement.");
      setEditMode(false);
      return;
    }

    setStatus(`Enregistrement... (${updates.length} modifs)`);

    // batch updates
    const chunkSize = 50;
    for (let i = 0; i < updates.length; i += chunkSize) {
      const chunk = updates.slice(i, i + chunkSize);
      const res = await Promise.all(
        chunk.map((u) => supabase.from("matches").update({ start_time: u.start_time, field_idx: u.field_idx }).eq("id", u.id))
      );
      const firstErr = res.find((r) => (r as any).error)?.error;
      if (firstErr) {
        setStatus("Erreur enregistrement: " + firstErr.message);
        return;
      }
    }

    setEditMode(false);
    setSelectedCell(null);
    setStatus("✅ Modifications enregistrées.");
    await refreshMatches();
  }

  function cellKey(hhmm: string, fieldIdx: number) {
    return `${hhmm}|${fieldIdx}`;
  }

  function onCellClick(hhmm: string, fieldIdx: number) {
    if (!editMode) return;

    if (isPaused(fieldIdx, hhmm)) return;

    const key = cellKey(hhmm, fieldIdx);
    if (!selectedCell) {
      setSelectedCell(key);
      return;
    }

    if (selectedCell === key) {
      setSelectedCell(null);
      return;
    }

    // swap selectedCell <-> key (can be empty)
    const [sTime, sFieldStr] = selectedCell.split("|");
    const sField = Number(sFieldStr);

    const a = matchMap.get(cellKey(sTime, sField)) ?? null;
    const b = matchMap.get(cellKey(hhmm, fieldIdx)) ?? null;

    // Éviter de déplacer vers pause
    if (isPaused(sField, sTime) || isPaused(fieldIdx, hhmm)) {
      setStatus("⚠️ Impossible: une des cellules est en pause.");
      setSelectedCell(null);
      return;
    }

    setMatches((prev) => {
      const next = prev.map((m) => ({ ...m }));

      // helper update match position
      const move = (matchId: string, newTime: string, newField: number) => {
        const idx = next.findIndex((x) => x.id === matchId);
        if (idx >= 0) {
          next[idx].start_time = newTime; // time string
          next[idx].field_idx = newField;
        }
      };

      if (a && b) {
        move(a.id, normHHMM(b.start_time), Number(b.field_idx));
        move(b.id, sTime, sField);
      } else if (a && !b) {
        move(a.id, hhmm, fieldIdx);
      } else if (!a && b) {
        move(b.id, sTime, sField);
      }

      // keep sorted for list mode + grid mapping
      next.sort((x, y) => {
        const ax = timeToMin(normHHMM(x.start_time));
        const ay = timeToMin(normHHMM(y.start_time));
        if (ax !== ay) return ax - ay;
        return Number(x.field_idx) - Number(y.field_idx);
      });

      return next;
    });

    setSelectedCell(null);
  }

  async function generateMatches() {
    if (!t) return;

    setEditMode(false);
    setSelectedCell(null);
    setStatus("Génération des matchs...");

    const { data: teamRows, error: teamErr } = await supabase
      .from("teams")
      .select("id,name,group_idx")
      .eq("tournament_id", tournamentId)
      .order("created_at", { ascending: true });

    if (teamErr) return setStatus("Erreur teams: " + teamErr.message);

    const teams = (teamRows ?? []) as Team[];
    setTeamsCount(teams.length);

    // contrôles min/max + capacité
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

    // Génération des paires
    let sequence: Array<{ a: string; b: string; groupIdx: number }> = [];

    if (showGroups) {
      // regrouper par poule
      const groups = new Map<number, Team[]>();
      for (const tm of teams) {
        const g = clampInt(Number(tm.group_idx ?? 1), 1, groupCount);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g)!.push(tm);
      }

      // construire pairs par poule
      const list: { groupIdx: number; pairs: Array<{ a: string; b: string; round: number }> }[] = [];
      for (let g = 1; g <= groupCount; g++) {
        const gTeams = groups.get(g) ?? [];
        if (gTeams.length < 2) continue; // poule vide ou 1 équipe -> aucun match
        const pairs = roundRobinPairs(gTeams.map((x) => x.id));
        list.push({ groupIdx: g, pairs });
      }

      sequence = interleaveByGroups(list);
    } else {
      const pairs = roundRobinPairs(teams.map((x) => x.id));
      sequence = pairs.map((p) => ({ a: p.a, b: p.b, groupIdx: 1 }));
    }

    const mustMatches = sequence.length;
    if (mustMatches > totalPlayableSlots) {
      setStatus(
        `Planning impossible: ${mustMatches} matchs requis, mais seulement ${totalPlayableSlots} créneaux jouables (horaires/pauses/terrains).`
      );
      return;
    }

    // On supprime les matchs existants
    const { error: delErr } = await supabase.from("matches").delete().eq("tournament_id", tournamentId);
    if (delErr) return setStatus("Erreur delete matches: " + delErr.message);

    // Créneaux jouables: on remplit “tous terrains à chaque temps” sauf pauses
    const allSlots: Array<{ start: string; fieldIdx: number; timeIndex: number }> = [];
    const fieldCount = t.num_fields ?? 1;

    for (const hhmm of timeline) {
      const ti = timeIndexMap.get(hhmm) ?? 0;
      for (let f = 1; f <= fieldCount; f++) {
        if (!isPaused(f, hhmm)) allSlots.push({ start: hhmm, fieldIdx: f, timeIndex: ti });
      }
    }

// Placement “contraintes” (anti-enchaînement + équité stricte)
const lastTimeIndex = new Map<string, number>();
const busyAtTime = new Map<string, Set<string>>();
const fieldUsage = new Map<number, number>(); // équilibrage terrain

// ✅ Comptage matchs joués (global + par poule)
const playedCount = new Map<string, number>();
const playedCountByGroup = new Map<number, Map<string, number>>();

for (const tm of teams) {
  const g = clampInt(Number(tm.group_idx ?? 1), 1, groupCount);

  playedCount.set(tm.id, 0);
  lastTimeIndex.set(tm.id, -9999);

  if (!playedCountByGroup.has(g)) playedCountByGroup.set(g, new Map());
  playedCountByGroup.get(g)!.set(tm.id, 0);
}

for (let f = 1; f <= fieldCount; f++) fieldUsage.set(f, 0);

const scheduled: Array<{
  tournament_id: string;
  home_team_id: string;
  away_team_id: string;
  field_idx: number;
  start_time: string;
}> = [];

function minMaxGlobalAfter(a: string, b: string) {
  const values = Array.from(playedCount.values());
  const minV = values.length ? Math.min(...values) : 0;
  let maxV = values.length ? Math.max(...values) : 0;

  const ca = playedCount.get(a) ?? 0;
  const cb = playedCount.get(b) ?? 0;

  maxV = Math.max(maxV, ca + 1, cb + 1);
  return { minV, maxV };
}

function minMaxGroupAfter(groupIdx: number, a: string, b: string) {
  const m = playedCountByGroup.get(groupIdx);
  if (!m) return { minV: 0, maxV: 0 };

  const values = Array.from(m.values());
  const minV = values.length ? Math.min(...values) : 0;
  let maxV = values.length ? Math.max(...values) : 0;

  const ca = m.get(a) ?? 0;
  const cb = m.get(b) ?? 0;

  maxV = Math.max(maxV, ca + 1, cb + 1);
  return { minV, maxV };
}

function restOkStrict(teamId: string, timeIndex: number) {
  const last = lastTimeIndex.get(teamId) ?? -9999;
  return timeIndex - last >= 2;
}

let ptr = 0;

for (const slot of allSlots) {
  if (ptr >= sequence.length) break;

  const timeKey = slot.start;
  if (!busyAtTime.has(timeKey)) busyAtTime.set(timeKey, new Set());
  const busySet = busyAtTime.get(timeKey)!;

  const passes: Array<{ strictRest: boolean }> = [
    { strictRest: true },
    { strictRest: false },
  ];

  let chosenIndex = -1;

  for (const pass of passes) {
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    const window = 180;
    const endPtr = Math.min(sequence.length, ptr + window);

    for (let i = ptr; i < endPtr; i++) {
      const cand = sequence[i];
      const a = cand.a;
      const b = cand.b;
      const g = clampInt(Number(cand.groupIdx ?? 1), 1, groupCount);

      if (busySet.has(a) || busySet.has(b)) continue;

      // Anti-enchaînement strict
      if (pass.strictRest) {
        if (!restOkStrict(a, slot.timeIndex) || !restOkStrict(b, slot.timeIndex)) continue;
      }

      // Équité globale stricte: max-min <= 1
      const gg = minMaxGlobalAfter(a, b);
      if (gg.maxV - gg.minV > 1) continue;

      // Équité poule stricte: max-min <= 1
      const mg = minMaxGroupAfter(g, a, b);
      if (mg.maxV - mg.minV > 1) continue;

      // Score heuristique
      const usage = fieldUsage.get(slot.fieldIdx) ?? 0;
      const fieldPenalty = usage * 2;

      const orderPenalty = (i - ptr) * 1.2;

      let relaxPenalty = 0;
      if (!pass.strictRest) {
        const la = lastTimeIndex.get(a) ?? -9999;
        const lb = lastTimeIndex.get(b) ?? -9999;
        const consA = slot.timeIndex - la < 2;
        const consB = slot.timeIndex - lb < 2;
        if (consA || consB) relaxPenalty = 80;
      }

      const ca = playedCount.get(a) ?? 0;
      const cb = playedCount.get(b) ?? 0;
      const lowPlayedBonus = (ca + cb) * 0.5;

      const score = fieldPenalty + orderPenalty + relaxPenalty + lowPlayedBonus;

      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }

    if (bestIndex !== -1) {
      chosenIndex = bestIndex;
      break;
    }
  }

  if (chosenIndex === -1) continue;

  [sequence[ptr], sequence[chosenIndex]] = [sequence[chosenIndex], sequence[ptr]];
  const chosen = sequence[ptr];
  const gChosen = clampInt(Number(chosen.groupIdx ?? 1), 1, groupCount);

  scheduled.push({
    tournament_id: tournamentId,
    home_team_id: chosen.a,
    away_team_id: chosen.b,
    field_idx: slot.fieldIdx,
    start_time: slot.start,
  });

  busySet.add(chosen.a);
  busySet.add(chosen.b);

  lastTimeIndex.set(chosen.a, slot.timeIndex);
  lastTimeIndex.set(chosen.b, slot.timeIndex);

  playedCount.set(chosen.a, (playedCount.get(chosen.a) ?? 0) + 1);
  playedCount.set(chosen.b, (playedCount.get(chosen.b) ?? 0) + 1);

  const mapG = playedCountByGroup.get(gChosen);
  if (mapG) {
    mapG.set(chosen.a, (mapG.get(chosen.a) ?? 0) + 1);
    mapG.set(chosen.b, (mapG.get(chosen.b) ?? 0) + 1);
  }

  fieldUsage.set(slot.fieldIdx, (fieldUsage.get(slot.fieldIdx) ?? 0) + 1);

  ptr++;
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
              Équipes: {teamsCount} (min {t.min_teams ?? 2} / max {t.max_teams ?? 24}) ·{" "}
              {showGroups ? (
                <>
                  Format: <strong>Poules</strong> ({groupCount}) · Matchs requis (poules): <strong>{matches.length || "—"}</strong>
                </>
              ) : (
                <>
                  Matchs requis (RR): {neededMatches}
                </>
              )}{" "}
              · Créneaux jouables: {totalPlayableSlots} · Matchs programmés: {matches.length}
            </p>

            {showGroups && (
              <p className="text-xs text-gray-500 mt-1">
                Poules: {groupNames.join(" · ")}
              </p>
            )}

            {estimate && (
              <p className="text-sm text-gray-500">
                Fin estimée (théorique): <strong>{estimate.endTheoretical ?? "—"}</strong>
                {estimate.exceedsWindow ? " (dépasse l’heure de fin définie)" : ""}
                {" · "}Slots requis (approx): <strong>{estimate.theoreticalSlotsCount}</strong>
                {" · "}Capacité jouable (avec pauses): <strong>{estimate.capacityPlayable}</strong>
              </p>
            )}
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

        <div className="bg-white rounded-xl shadow p-6 flex items-center justify-between gap-3 flex-wrap">
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

            {viewMode === "grid" && (
              <>
                {!editMode ? (
                  <button
                    onClick={enterEditMode}
                    className="bg-black text-white px-4 py-2 rounded-lg hover:bg-gray-900 transition"
                    title="Permet d'échanger/déplacer des matchs dans la grille"
                  >
                    ✏️ Modifier manuellement
                  </button>
                ) : (
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={saveManualEdits}
                      className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition"
                    >
                      💾 Enregistrer
                    </button>
                    <button
                      onClick={cancelEditMode}
                      className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
                    >
                      Annuler
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          <button
            onClick={generateMatches}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
          >
            ⚙️ Générer les matchs
          </button>
        </div>

        {status && <div className="bg-white rounded-xl shadow p-4 text-gray-700">{status}</div>}

        {viewMode === "grid" && (
          <div className="bg-white rounded-xl shadow p-6 overflow-auto">
            {editMode && (
              <div className="mb-4 text-sm text-gray-600">
                ✅ Mode édition: clique une cellule (match) puis une autre cellule pour <strong>échanger</strong> ou <strong>déplacer</strong> le match.
                <br />
                Les cellules <strong>PAUSE</strong> sont bloquées.
              </div>
            )}

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
                        const isSel = selectedCell === key;

                        if (match) {
                          return (
                            <td key={key} className="p-2 border-b">
                              <button
                                type="button"
                                onClick={() => onCellClick(hhmm, fieldIdx)}
                                disabled={!editMode}
                                className={`w-full text-left rounded-lg border p-3 transition ${
                                  isSel
                                    ? "bg-yellow-50 border-yellow-300 ring-2 ring-yellow-300"
                                    : editMode
                                      ? "bg-green-50 hover:bg-green-100 border-green-200"
                                      : "bg-green-50 border-green-200"
                                }`}
                              >
                                <div className="text-xs font-semibold mb-1 text-gray-600">
                                  {editMode ? "CLIQUE POUR DÉPLACER / ÉCHANGER" : "MATCH"}
                                </div>
                                <div className="font-semibold text-gray-900">{match.home?.name ?? "Équipe A"}</div>
                                <div className="text-sm text-gray-700">vs</div>
                                <div className="font-semibold text-gray-900">{match.away?.name ?? "Équipe B"}</div>
                              </button>
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
                            <button
                              type="button"
                              onClick={() => onCellClick(hhmm, fieldIdx)}
                              disabled={!editMode}
                              className={`w-full rounded-lg border p-3 text-sm transition ${
                                isSel
                                  ? "bg-yellow-50 border-yellow-300 ring-2 ring-yellow-300"
                                  : editMode
                                    ? "bg-gray-50 hover:bg-gray-100"
                                    : "bg-gray-50"
                              }`}
                            >
                              <div className="text-gray-400">—</div>
                              {editMode && <div className="text-xs text-gray-500 mt-1">Clique pour déplacer ici</div>}
                            </button>
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
                      <strong>{normHHMM(m.start_time)}</strong> ·{" "}
                      {fieldNames[(m.field_idx ?? 1) - 1] ?? `Terrain ${m.field_idx}`}
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