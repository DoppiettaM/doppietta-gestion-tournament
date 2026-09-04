"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { TIE_BREAKER_LABELS, TieBreaker } from "@/lib/challenge";
import { MICHEL_CLIPET_PHASES, normalizePhaseConfig, PhaseDestination, TournamentPhaseConfig } from "@/lib/tournamentPhases";

type Pause = { from: string; to: string };

type TournamentPause =
  | { type: "tournament"; from: string; to: string }
  | { type: "tournament_except"; from: string; to: string; exceptFields: number[] };

type TournamentRow = {
  id: string;
  title: string | null;

  tournament_date: string | null;
  min_teams: number | null;
  max_teams: number | null;

  start_time: string | null;
  end_time: string | null;

  match_duration_min: number | null;
  rotation_duration_min: number | null;

  num_fields: number | null;
  field_names: string[] | null;

  min_players_per_team: number | null;
  max_players_per_team: number | null;
  min_staff_per_team: number | null;
  max_staff_per_team: number | null;
  venue: string | null;

  format: string | null;
  group_count: number | null;
  group_names: string[] | null;
  standings_tiebreakers: TieBreaker[] | null;
  knockout_tiebreakers: TieBreaker[] | null;
  bracket_config: Record<string, unknown> | null;
  referee_rest_slots: number | null;

  pauses: any | null;
  field_pauses: any | null;

  screen_partner_top_1_url: string | null;
  screen_partner_top_2_url: string | null;
  screen_partner_bottom_1_url: string | null;
  screen_partner_bottom_2_url: string | null;
};

function clampInt(v: string, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function clean(s: string) {
  return (s ?? "").trim();
}

function asHHMM(v: string | null, fallback: string) {
  const s = clean(v ?? "");
  if (!s) return fallback;
  return s.slice(0, 5);
}

function safeArray<T = any>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function safeRecord(v: any): Record<string, any> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {};
}

function isTime(s: string) {
  return /^\d{2}:\d{2}$/.test(s);
}

function hasAnyPause(fieldPauses: Record<string, Pause[]>) {
  return Object.values(fieldPauses).some((arr) => Array.isArray(arr) && arr.length > 0);
}

const AVAILABLE_TIES: TieBreaker[] = ["points", "goals_scored", "goal_difference", "goals_conceded", "penalty_shootout", "draw"];

function validTieBreakers(value: unknown, fallback: TieBreaker[], allowPoints: boolean) {
  if (!Array.isArray(value)) return fallback;
  const valid = value.filter((rule): rule is TieBreaker => typeof rule === "string" && AVAILABLE_TIES.includes(rule as TieBreaker) && (allowPoints || rule !== "points"));
  return valid.length >= 3 ? valid.slice(0, 5) : fallback;
}

function RuleOrder({ value, setValue, allowPoints }: { value: TieBreaker[]; setValue: (next: TieBreaker[]) => void; allowPoints: boolean }) {
  const available = AVAILABLE_TIES.filter(rule => (allowPoints || rule !== "points") && !value.includes(rule));
  function move(index: number, delta: number) {
    const target = index + delta; if (target < 0 || target >= value.length) return;
    const next = [...value]; [next[index], next[target]] = [next[target], next[index]]; setValue(next);
  }
  return <div className="space-y-2">
    {value.map((rule, index) => <div key={rule} className="flex justify-between items-center bg-slate-50 rounded-lg p-2 text-sm">
      <span><strong>{index + 1}.</strong> {TIE_BREAKER_LABELS[rule]}</span>
      <span><button type="button" onClick={() => move(index, -1)} className="px-2">↑</button><button type="button" onClick={() => move(index, 1)} className="px-2">↓</button><button type="button" disabled={value.length <= 3} onClick={() => setValue(value.filter(x => x !== rule))} className="px-2 text-red-600 disabled:opacity-30">×</button></span>
    </div>)}
    <div className="flex flex-wrap gap-2">{available.map(rule => <button type="button" key={rule} disabled={value.length >= 5} onClick={() => setValue([...value, rule])} className="border rounded-lg px-2 py-1 text-xs disabled:opacity-30">＋ {TIE_BREAKER_LABELS[rule]}</button>)}</div>
  </div>;
}

export default function TournamentSettingsPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = String(params.id);

  const [status, setStatus] = useState("Chargement...");
  const [saving, setSaving] = useState(false);
  const [uploadingPartner, setUploadingPartner] = useState<string | null>(null);

  const [t, setT] = useState<TournamentRow | null>(null);

  // Form states
  const [title, setTitle] = useState("");
  const [tournamentDate, setTournamentDate] = useState("");

  const [minTeams, setMinTeams] = useState("2");
  const [maxTeams, setMaxTeams] = useState("24");

  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");

  const [matchDurationMin, setMatchDurationMin] = useState("12");
  const [rotationDurationMin, setRotationDurationMin] = useState("3");

  const [numFields, setNumFields] = useState("2");
  const [fieldNames, setFieldNames] = useState<string[]>(["Terrain 1", "Terrain 2"]);

  const [minPlayers, setMinPlayers] = useState("6");
  const [maxPlayers, setMaxPlayers] = useState("7");
  const [minStaff, setMinStaff] = useState("1");
  const [maxStaff, setMaxStaff] = useState("5");
  const [venue, setVenue] = useState("");

  // Format / Poules
  const [format, setFormat] = useState("round_robin");
  const [groupCount, setGroupCount] = useState("1");
  const [groupNames, setGroupNames] = useState<string[]>(["Poule 1"]);
  const [standingsTies, setStandingsTies] = useState<TieBreaker[]>(["points", "goal_difference", "goals_scored"]);
  const [knockoutTies, setKnockoutTies] = useState<TieBreaker[]>(["goal_difference", "penalty_shootout", "draw"]);
  const [qualifiersPerGroup, setQualifiersPerGroup] = useState("2");
  const [phaseConfig, setPhaseConfig] = useState<TournamentPhaseConfig>(MICHEL_CLIPET_PHASES);
  const [refereeRestSlots, setRefereeRestSlots] = useState("1");

  // Pauses
  const [pausesEnabled, setPausesEnabled] = useState(false);
  const [fieldPauses, setFieldPauses] = useState<Record<string, Pause[]>>({});

  // Partenaires écran
  const [partnerTop1, setPartnerTop1] = useState<string | null>(null);
  const [partnerTop2, setPartnerTop2] = useState<string | null>(null);
  const [partnerBottom1, setPartnerBottom1] = useState<string | null>(null);
  const [partnerBottom2, setPartnerBottom2] = useState<string | null>(null);

  const fieldCount = useMemo(() => Math.max(1, clampInt(numFields, 1)), [numFields]);
  const groupsN = useMemo(() => Math.max(1, Math.min(8, clampInt(groupCount, 1))), [groupCount]);

  useEffect(() => {
    setFieldNames((prev) => {
      const next = [...prev];
      while (next.length < fieldCount) next.push(`Terrain ${next.length + 1}`);
      while (next.length > fieldCount) next.pop();
      return next;
    });
  }, [fieldCount]);

  useEffect(() => {
    setGroupNames((prev) => {
      const next = [...prev];
      while (next.length < groupsN) next.push(`Poule ${next.length + 1}`);
      while (next.length > groupsN) next.pop();
      return next;
    });
  }, [groupsN]);

  useEffect(() => {
    setFieldPauses((prev) => {
      const next: Record<string, Pause[]> = { ...prev };
      for (let f = 1; f <= fieldCount; f++) {
        if (!next[String(f)]) next[String(f)] = [];
      }
      for (const k of Object.keys(next)) {
        const idx = Number(k);
        if (!Number.isFinite(idx) || idx < 1 || idx > fieldCount) delete next[k];
      }
      return next;
    });
  }, [fieldCount]);

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return router.push("/login");

      const { data, error } = await supabase
        .from("tournaments")
        .select(
          "id,title,tournament_date,venue,min_teams,max_teams,start_time,end_time,match_duration_min,rotation_duration_min,num_fields,field_names,min_players_per_team,max_players_per_team,min_staff_per_team,max_staff_per_team,format,group_count,group_names,standings_tiebreakers,knockout_tiebreakers,bracket_config,referee_rest_slots,pauses,field_pauses,screen_partner_top_1_url,screen_partner_top_2_url,screen_partner_bottom_1_url,screen_partner_bottom_2_url"
        )
        .eq("id", tournamentId)
        .single();

      if (error) {
        setStatus("Erreur chargement: " + error.message);
        return;
      }

      const row = (data ?? null) as any as TournamentRow;
      setT(row);

      setTitle(row.title ?? "");
      setTournamentDate(row.tournament_date ?? "");
      setVenue(row.venue ?? "");

      setMinTeams(String(row.min_teams ?? 2));
      setMaxTeams(String(row.max_teams ?? 24));

      setStartTime(asHHMM(row.start_time, "09:00"));
      setEndTime(asHHMM(row.end_time, "18:00"));

      setMatchDurationMin(String(row.match_duration_min ?? 12));
      setRotationDurationMin(String(row.rotation_duration_min ?? 3));

      setNumFields(String(row.num_fields ?? 2));
      setFieldNames(row.field_names && row.field_names.length ? row.field_names : ["Terrain 1", "Terrain 2"]);

      setMinPlayers(String(row.min_players_per_team ?? 6));
      setMaxPlayers(String(row.max_players_per_team ?? 7));
      setMinStaff(String(row.min_staff_per_team ?? 1));
      setMaxStaff(String(row.max_staff_per_team ?? 5));

      setFormat(row.format ?? "round_robin");
      setGroupCount(String(row.group_count ?? 1));
      setGroupNames(row.group_names && row.group_names.length ? row.group_names : ["Poule 1"]);
      setStandingsTies(validTieBreakers(row.standings_tiebreakers, ["points", "goal_difference", "goals_scored"], true));
      setKnockoutTies(validTieBreakers(row.knockout_tiebreakers, ["goals_scored", "goal_difference", "penalty_shootout"], false));
      setQualifiersPerGroup(String(Number(row.bracket_config?.qualifiers_per_group ?? 2)));
      setPhaseConfig(normalizePhaseConfig(row.bracket_config?.phase_config));
      setRefereeRestSlots(String(row.referee_rest_slots ?? 1));

      const fp = safeRecord(row.field_pauses);
      const normalized: Record<string, Pause[]> = {};
      for (let f = 1; f <= Math.max(1, Number(row.num_fields ?? 1)); f++) {
        const key = String(f);
        const arr = safeArray<Pause>(fp[key]);
        normalized[key] = arr
          .map((x) => ({ from: clean((x as any)?.from), to: clean((x as any)?.to) }))
          .filter((x) => isTime(x.from) && isTime(x.to));
      }
      setFieldPauses(normalized);

      const pausesLegacy = safeArray<TournamentPause>(row.pauses);
      const legacyOn =
        pausesLegacy.some((p: any) => p?.type === "tournament" && isTime(p?.from) && isTime(p?.to)) ||
        pausesLegacy.some((p: any) => p?.type === "tournament_except" && isTime(p?.from) && isTime(p?.to));

      setPausesEnabled(legacyOn || hasAnyPause(normalized));

      setPartnerTop1(row.screen_partner_top_1_url ?? null);
      setPartnerTop2(row.screen_partner_top_2_url ?? null);
      setPartnerBottom1(row.screen_partner_bottom_1_url ?? null);
      setPartnerBottom2(row.screen_partner_bottom_2_url ?? null);

      setStatus("");
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, tournamentId]);

  function updateFieldName(i: number, v: string) {
    setFieldNames((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
  }

  function updateGroupName(i: number, v: string) {
    setGroupNames((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });
  }

  function addFieldPause(fieldIdx: number) {
    setFieldPauses((prev) => {
      const key = String(fieldIdx);
      const arr = prev[key] ?? [];
      return { ...prev, [key]: [...arr, { from: "12:00", to: "12:30" }] };
    });
    setPausesEnabled(true);
  }

  function updateFieldPause(fieldIdx: number, pauseIdx: number, key: "from" | "to", value: string) {
    setFieldPauses((prev) => {
      const fKey = String(fieldIdx);
      const arr = [...(prev[fKey] ?? [])];
      arr[pauseIdx] = { ...arr[pauseIdx], [key]: value };
      return { ...prev, [fKey]: arr };
    });
  }

  function removeFieldPause(fieldIdx: number, pauseIdx: number) {
    setFieldPauses((prev) => {
      const fKey = String(fieldIdx);
      const arr = [...(prev[fKey] ?? [])];
      arr.splice(pauseIdx, 1);
      return { ...prev, [fKey]: arr };
    });
  }

  async function uploadPartner(file: File, slot: "top1" | "top2" | "bottom1" | "bottom2") {
    try {
      const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
      if (!allowed.includes(file.type)) {
        setStatus("⚠️ Format image non supporté. Utilise PNG, JPG ou WEBP.");
        return;
      }

      setUploadingPartner(slot);
      setStatus("");

      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const safeName = `${slot}_${Date.now()}.${ext}`;
      const filePath = `${tournamentId}/${safeName}`;

      const { error: uploadError } = await supabase.storage.from("partners").upload(filePath, file, {
        upsert: true,
      });

      if (uploadError) {
        setStatus("Erreur upload partenaire: " + uploadError.message);
        setUploadingPartner(null);
        return;
      }

      const { data } = supabase.storage.from("partners").getPublicUrl(filePath);
      const url = data.publicUrl;

      if (slot === "top1") setPartnerTop1(url);
      if (slot === "top2") setPartnerTop2(url);
      if (slot === "bottom1") setPartnerBottom1(url);
      if (slot === "bottom2") setPartnerBottom2(url);

      setStatus("✅ Image partenaire chargée. N’oublie pas de sauvegarder.");
      setUploadingPartner(null);
    } catch (e: any) {
      setStatus("Erreur upload partenaire: " + (e?.message || "inconnue"));
      setUploadingPartner(null);
    }
  }

  function clearPartner(slot: "top1" | "top2" | "bottom1" | "bottom2") {
    if (slot === "top1") setPartnerTop1(null);
    if (slot === "top2") setPartnerTop2(null);
    if (slot === "bottom1") setPartnerBottom1(null);
    if (slot === "bottom2") setPartnerBottom2(null);
  }

  function validate() {
    if (!clean(title)) return "Le titre est obligatoire.";

    const minT = clampInt(minTeams, 2);
    const maxT = clampInt(maxTeams, 24);
    if (minT < 2) return "min_teams doit être ≥ 2.";
    if (maxT < 2) return "max_teams doit être ≥ 2.";
    if (minT > maxT) return "min_teams ne peut pas être > max_teams.";

    if (clean(endTime) <= clean(startTime)) return "end_time doit être après start_time.";

    const md = clampInt(matchDurationMin, 1);
    const rd = clampInt(rotationDurationMin, 0);
    if (md < 1) return "Durée de match invalide.";
    if (rd < 0) return "Durée de rotation invalide.";

    const minP = clampInt(minPlayers, 1);
    const maxP = clampInt(maxPlayers, 1);
    if (minP < 1) return "min joueurs/équipe doit être ≥ 1.";
    if (maxP < 1) return "max joueurs/équipe doit être ≥ 1.";
    if (minP > maxP) return "min joueurs/équipe ne peut pas être > max.";
    const minS = clampInt(minStaff, 1);
    const maxS = clampInt(maxStaff, 1);
    if (minS < 1 || maxS < 1) return "Le nombre d’encadrants doit être ≥ 1.";
    if (minS > maxS) return "min encadrants/équipe ne peut pas être > max.";

    if (pausesEnabled) {
      for (const [k, arr] of Object.entries(fieldPauses)) {
        for (const p of arr) {
          if (!isTime(p.from) || !isTime(p.to)) return `Pause terrain ${k}: heure invalide.`;
          if (p.to <= p.from) return `Pause terrain ${k}: "à" doit être après "de".`;
        }
      }
    }

    return "";
  }

  async function save() {
    const err = validate();
    if (err) {
      setStatus("Erreur: " + err);
      return;
    }

    setSaving(true);
    setStatus("");

    const finalFieldPauses = pausesEnabled ? fieldPauses : {};
    const finalPausesLegacy: TournamentPause[] = [];

    const payload: any = {
      title: clean(title),
      venue: clean(venue) || null,

      tournament_date: tournamentDate || null,
      min_teams: clampInt(minTeams, 2),
      max_teams: clampInt(maxTeams, 24),

      start_time: clean(startTime).slice(0, 5),
      end_time: clean(endTime).slice(0, 5),

      match_duration_min: clampInt(matchDurationMin, 12),
      rotation_duration_min: clampInt(rotationDurationMin, 3),

      num_fields: fieldCount,
      field_names: fieldNames.map((x) => clean(x) || "Terrain"),

      min_players_per_team: clampInt(minPlayers, 6),
      max_players_per_team: clampInt(maxPlayers, 7),
      min_staff_per_team: clampInt(minStaff, 1),
      max_staff_per_team: clampInt(maxStaff, 5),

      format: format || "round_robin",
      group_count: groupsN,
      group_names: groupNames.map((x) => clean(x) || "Poule"),
      standings_tiebreakers: standingsTies,
      knockout_tiebreakers: knockoutTies,
      bracket_config: { qualifiers_per_group: clampInt(qualifiersPerGroup, 2), phase_config: phaseConfig },
      referee_rest_slots: Math.max(0, clampInt(refereeRestSlots, 1)),

      pauses: finalPausesLegacy,
      field_pauses: finalFieldPauses,

      screen_partner_top_1_url: partnerTop1,
      screen_partner_top_2_url: partnerTop2,
      screen_partner_bottom_1_url: partnerBottom1,
      screen_partner_bottom_2_url: partnerBottom2,
    };

    const { error } = await supabase.from("tournaments").update(payload).eq("id", tournamentId);

    if (error) {
      setStatus("Erreur sauvegarde: " + error.message);
      setSaving(false);
      return;
    }

    setStatus("✅ Paramètres sauvegardés. Les pages se mettront à jour automatiquement.");
    setSaving(false);
  }

  if (!t) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="max-w-4xl mx-auto bg-white rounded-xl shadow p-6">{status}</div>
      </main>
    );
  }

  const partnerCards = [
    { key: "top1" as const, label: "Partenaire haut #1", value: partnerTop1 },
    { key: "top2" as const, label: "Partenaire haut #2", value: partnerTop2 },
    { key: "bottom1" as const, label: "Publicité bas #1", value: partnerBottom1 },
    { key: "bottom2" as const, label: "Publicité bas #2", value: partnerBottom2 },
  ];

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-6 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Réglages du tournoi</h1>
            <p className="text-sm text-gray-500">
              Tournoi: <span className="font-semibold">{t.title ?? tournamentId}</span>
            </p>
            {status && <p className="text-sm text-amber-700 mt-2">{status}</p>}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              ← Retour
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
            >
              {saving ? "..." : "💾 Sauvegarder"}
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-600">Titre</label>
              <input className="w-full border rounded-lg p-2" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div>
              <label className="text-sm text-gray-600">Date du tournoi</label>
              <input
                type="date"
                className="w-full border rounded-lg p-2"
                value={tournamentDate}
                onChange={(e) => setTournamentDate(e.target.value)}
              />
            </div>

            <div>
              <label className="text-sm text-gray-600">Min équipes</label>
              <input className="w-full border rounded-lg p-2" type="number" value={minTeams} onChange={(e) => setMinTeams(e.target.value)} />
            </div>

            <div>
              <label className="text-sm text-gray-600">Max équipes</label>
              <input className="w-full border rounded-lg p-2" type="number" value={maxTeams} onChange={(e) => setMaxTeams(e.target.value)} />
            </div>

            <div>
              <label className="text-sm text-gray-600">Heure début</label>
              <input className="w-full border rounded-lg p-2" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>

            <div>
              <label className="text-sm text-gray-600">Heure fin</label>
              <input className="w-full border rounded-lg p-2" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>

            <div>
              <label className="text-sm text-gray-600">Durée match (min)</label>
              <input className="w-full border rounded-lg p-2" type="number" value={matchDurationMin} onChange={(e) => setMatchDurationMin(e.target.value)} />
            </div>

            <div>
              <label className="text-sm text-gray-600">Durée rotation (min)</label>
              <input className="w-full border rounded-lg p-2" type="number" value={rotationDurationMin} onChange={(e) => setRotationDurationMin(e.target.value)} />
            </div>

            <div>
              <label className="text-sm text-gray-600">Min joueurs / équipe</label>
              <input className="w-full border rounded-lg p-2" type="number" value={minPlayers} onChange={(e) => setMinPlayers(e.target.value)} />
            </div>

            <div>
              <label className="text-sm text-gray-600">Max joueurs / équipe</label>
              <input className="w-full border rounded-lg p-2" type="number" value={maxPlayers} onChange={(e) => setMaxPlayers(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-gray-600">Min encadrants / équipe</label>
              <input className="w-full border rounded-lg p-2" type="number" min="1" value={minStaff} onChange={(e) => setMinStaff(e.target.value)} />
            </div>
            <div>
              <label className="text-sm text-gray-600">Max encadrants / équipe</label>
              <input className="w-full border rounded-lg p-2" type="number" min="1" value={maxStaff} onChange={(e) => setMaxStaff(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm text-gray-600">Lieu du tournoi</label>
              <input className="w-full border rounded-lg p-2" value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Stade, ville…" />
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="font-semibold">Terrains</div>

            <div>
              <label className="text-sm text-gray-600">Nombre de terrains</label>
              <input className="w-full border rounded-lg p-2" type="number" value={numFields} onChange={(e) => setNumFields(e.target.value)} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {fieldNames.map((n, i) => (
                <div key={i}>
                  <label className="text-sm text-gray-600">Terrain {i + 1}</label>
                  <input className="w-full border rounded-lg p-2" value={n} onChange={(e) => updateFieldName(i, e.target.value)} />
                </div>
              ))}
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="font-semibold">Pauses</div>

            <label className="flex items-center gap-3 border rounded-lg p-4 cursor-pointer select-none">
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={pausesEnabled}
                onChange={(e) => setPausesEnabled(e.target.checked)}
              />
              <div>
                <div className="font-semibold text-gray-900">Pause(s) à effectuer</div>
                <div className="text-xs text-gray-500">
                  Coche pour bloquer des terrains sur des plages horaires (ex: “Terrain France entre 12:00 et 13:00”).
                </div>
              </div>
            </label>

            {pausesEnabled && (
              <div className="border rounded-lg p-4 space-y-4 bg-slate-50">
                <div className="text-sm text-gray-700">
                  Règle appliquée: un terrain est considéré <strong>indisponible</strong> si un créneau (match+rotation)
                  chevauche la pause. Les pages Planning/Écran utilisent ces pauses automatiquement.
                </div>

                {Array.from({ length: fieldCount }, (_, idx) => {
                  const fieldIdx = idx + 1;
                  const pauses = fieldPauses[String(fieldIdx)] ?? [];
                  const terrainName = fieldNames[idx] ?? `Terrain ${fieldIdx}`;

                  return (
                    <div key={fieldIdx} className="border rounded-lg p-4 bg-white">
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="font-semibold">
                          Terrain <span className="text-gray-900">{terrainName}</span>
                        </div>

                        <button
                          onClick={() => addFieldPause(fieldIdx)}
                          className="bg-gray-100 px-3 py-2 rounded-lg hover:bg-gray-200 transition text-sm"
                          type="button"
                        >
                          + Ajouter une pause
                        </button>
                      </div>

                      {pauses.length === 0 ? (
                        <div className="text-sm text-gray-500 mt-2">Aucune pause définie.</div>
                      ) : (
                        <div className="space-y-2 mt-3">
                          {pauses.map((p, pIdx) => (
                            <div key={pIdx} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                              <div className="md:col-span-1">
                                <div className="text-xs text-gray-500 mb-1">Entre</div>
                                <input
                                  type="time"
                                  className="w-full border rounded-lg p-2"
                                  value={p.from}
                                  onChange={(e) => updateFieldPause(fieldIdx, pIdx, "from", e.target.value)}
                                />
                              </div>

                              <div className="md:col-span-1">
                                <div className="text-xs text-gray-500 mb-1">et</div>
                                <input
                                  type="time"
                                  className="w-full border rounded-lg p-2"
                                  value={p.to}
                                  onChange={(e) => updateFieldPause(fieldIdx, pIdx, "to", e.target.value)}
                                />
                              </div>

                              <div className="md:col-span-1 text-xs text-gray-600">
                                Pause #{pIdx + 1} sur <span className="font-semibold">{terrainName}</span>
                              </div>

                              <div className="md:col-span-1 flex md:justify-end">
                                <button
                                  type="button"
                                  onClick={() => removeFieldPause(fieldIdx, pIdx)}
                                  className="bg-red-600 text-white px-3 py-2 rounded-lg hover:bg-red-700 transition w-full md:w-auto"
                                >
                                  Supprimer
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="font-semibold">Partenaires écran géant</div>
            <div className="text-red-600 font-bold">TEST PARTENAIRES</div>
            <div className="text-xs text-gray-500">
              Format conseillé : <span className="font-mono">1600 × 400 px</span> (ratio 4:1). Formats acceptés : PNG, JPG, WEBP.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {partnerCards.map((card) => (
                <div key={card.key} className="border rounded-lg p-4 space-y-3 bg-slate-50">
                  <div className="font-semibold text-sm">{card.label}</div>

                  <div className="w-full h-28 border rounded-lg bg-white overflow-hidden flex items-center justify-center">
                    {card.value ? (
                      <img
                        src={card.value}
                        alt={card.label}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="text-xs text-gray-400 text-center px-3">
                        Aucun visuel chargé
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    <label className="bg-gray-200 px-3 py-2 rounded-lg hover:bg-gray-300 transition text-sm cursor-pointer">
                      {uploadingPartner === card.key ? "..." : "⬆️ Charger une image"}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadPartner(f, card.key);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => clearPartner(card.key)}
                      className="bg-red-100 text-red-700 px-3 py-2 rounded-lg hover:bg-red-200 transition text-sm"
                    >
                      Retirer
                    </button>
                  </div>

                  <div className="text-[11px] text-gray-500 break-all">
                    {card.value ? card.value : "Aucune URL"}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t pt-4 space-y-3">
            <div className="font-semibold">Format</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-gray-600">Format</label>
                <select className="w-full border rounded-lg p-2" value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="round_robin">Round Robin (tous ensemble)</option>
                  <option value="groups_round_robin">Poules (round robin)</option>
                  <option value="single_elimination">Élimination directe</option>
                  <option value="hybrid">Hybride (poules puis élimination)</option>
                </select>
                <div className="text-xs text-gray-500 mt-1">
                  La génération par poules est gérée dans Planning.
                </div>
              </div>

              <div>
                <label className="text-sm text-gray-600">Nombre de poules (1 à 8)</label>
                <input className="w-full border rounded-lg p-2" type="number" min={1} max={8} value={groupCount} onChange={(e) => setGroupCount(e.target.value)} />
              </div>
            </div>

            {format === "hybrid" && <div className="rounded-2xl border-2 border-sky-200 bg-sky-50 p-5 space-y-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div><h3 className="font-black text-lg">Organisation des phases</h3><p className="text-sm text-slate-600">Chaque rang de la phase précédente doit être reversé vers une poule ou un tableau. Cette configuration reste modifiable le jour J.</p></div>
                <button type="button" onClick={()=>setPhaseConfig(MICHEL_CLIPET_PHASES)} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white">Charger le format Michel Clipet</button>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-sm font-semibold">Nombre de phases<input type="number" min={1} max={6} className="mt-1 block w-full rounded-lg border p-2" value={phaseConfig.phaseCount} onChange={e=>setPhaseConfig(p=>({...p,phaseCount:Math.max(1,Math.min(6,Number(e.target.value))) }))}/></label>
                <label className="text-sm font-semibold">Composition de la phase suivante<select className="mt-1 block w-full rounded-lg border p-2" value={phaseConfig.assignmentMode} onChange={e=>setPhaseConfig(p=>({...p,assignmentMode:e.target.value as TournamentPhaseConfig["assignmentMode"]}))}><option value="ranking">Selon le classement précédent</option><option value="random">Aléatoire</option><option value="manual">Manuelle dans le dashboard</option></select></label>
                <label className="text-sm font-semibold">Qualifiés par poule<input className="mt-1 block w-full rounded-lg border p-2" type="number" min={1} max={8} value={qualifiersPerGroup} onChange={(e) => setQualifiersPerGroup(e.target.value)} /></label>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex gap-3 rounded-xl border bg-white p-3"><input type="checkbox" checked={phaseConfig.resetPointsAtPhase2} onChange={e=>setPhaseConfig(p=>({...p,resetPointsAtPhase2:e.target.checked}))}/><span><strong className="block">Remettre les points à zéro</strong><small>Les matchs de phase 2 créent un nouveau classement.</small></span></label>
                <label className="flex gap-3 rounded-xl border bg-white p-3"><input type="checkbox" checked={phaseConfig.carryGoalsToPhase2Tiebreak} onChange={e=>setPhaseConfig(p=>({...p,carryGoalsToPhase2Tiebreak:e.target.checked}))}/><span><strong className="block">Conserver les buts en mémoire</strong><small>BP, BC et différence de la phase 1 servent encore au départage.</small></span></label>
              </div>
              <div className="space-y-3">
                <h4 className="font-bold">Reversements après la phase 1</h4>
                {phaseConfig.destinations.map((destination,index)=><DestinationEditor key={destination.id} destination={destination} onChange={next=>setPhaseConfig(p=>({...p,destinations:p.destinations.map((d,i)=>i===index?next:d)}))} onRemove={()=>setPhaseConfig(p=>({...p,destinations:p.destinations.filter((_,i)=>i!==index)}))}/>) }
                <button type="button" onClick={()=>setPhaseConfig(p=>({...p,destinations:[...p.destinations,{id:`destination_${Date.now()}`,label:`Nouvelle destination`,kind:"group",ranks:[],finalPositions:[]}]}))} className="rounded-xl border border-sky-700 px-4 py-2 text-sm font-bold text-sky-800">+ Ajouter une poule ou un tableau</button>
              </div>
            </div>}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {groupNames.map((n, i) => (
                <div key={i}>
                  <label className="text-sm text-gray-600">Nom poule {i + 1}</label>
                  <input className="w-full border rounded-lg p-2" value={n} onChange={(e) => updateGroupName(i, e.target.value)} />
                </div>
              ))}
            </div>

            <div className="border rounded-xl p-4 space-y-3">
              <h3 className="font-semibold">Départage du classement (3 à 5)</h3>
              <RuleOrder value={standingsTies} setValue={setStandingsTies} allowPoints />
            </div>

            <div className="border rounded-xl p-4 space-y-3">
              <h3 className="font-semibold">Égalité en élimination directe</h3>
              <RuleOrder value={knockoutTies} setValue={setKnockoutTies} allowPoints={false} />
            </div>

            <label className="block border rounded-xl p-4">
              <span className="font-semibold">Repos souhaité avant arbitrage (créneaux)</span>
              <input className="block w-28 border rounded-lg p-2 mt-2" type="number" min={0} max={5} value={refereeRestSlots} onChange={(e) => setRefereeRestSlots(e.target.value)} />
            </label>
          </div>

          <div className="flex justify-end">
            <button
              onClick={save}
              disabled={saving}
              className="bg-blue-600 text-white px-5 py-3 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
            >
              {saving ? "..." : "💾 Sauvegarder"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function numberList(value:string){return value.split(/[;,\s]+/).map(Number).filter(n=>Number.isInteger(n)&&n>0)}
function DestinationEditor({destination,onChange,onRemove}:{destination:PhaseDestination;onChange:(next:PhaseDestination)=>void;onRemove:()=>void}){
  return <div className="grid gap-3 rounded-xl border bg-white p-4 md:grid-cols-[1.4fr_.7fr_1fr_1fr_auto]">
    <label className="text-xs font-bold text-slate-600">Nom<input className="mt-1 block w-full rounded-lg border p-2 text-sm text-slate-950" value={destination.label} onChange={e=>onChange({...destination,label:e.target.value})}/></label>
    <label className="text-xs font-bold text-slate-600">Type<select className="mt-1 block w-full rounded-lg border p-2 text-sm text-slate-950" value={destination.kind} onChange={e=>onChange({...destination,kind:e.target.value as PhaseDestination["kind"]})}><option value="group">Poule</option><option value="knockout">Tableau</option></select></label>
    <label className="text-xs font-bold text-slate-600">Rangs reversés<input className="mt-1 block w-full rounded-lg border p-2 text-sm text-slate-950" placeholder="5, 6, 7" value={destination.ranks.join(", ")} onChange={e=>onChange({...destination,ranks:numberList(e.target.value)})}/></label>
    <label className="text-xs font-bold text-slate-600">Places finales<input className="mt-1 block w-full rounded-lg border p-2 text-sm text-slate-950" placeholder="5, 6, 7" value={destination.finalPositions.join(", ")} onChange={e=>onChange({...destination,finalPositions:numberList(e.target.value)})}/></label>
    <button type="button" onClick={onRemove} className="self-end rounded-lg px-3 py-2 font-bold text-red-600">×</button>
    {destination.kind==="knockout"&&<label className="md:col-span-5 flex gap-3 text-sm"><input type="checkbox" checked={destination.consolationFinal!==false} onChange={e=>onChange({...destination,consolationFinal:e.target.checked})}/><span>Générer une finale et une petite finale. Les confrontations du modèle Michel Clipet sont 1–4 et 2–3.</span></label>}
  </div>
}
