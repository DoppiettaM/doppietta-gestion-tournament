"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Pause = { from: string; to: string };

type TournamentPause =
  | { type: "tournament"; from: string; to: string }
  | { type: "tournament_except"; from: string; to: string; exceptFields: number[] };

type TournamentRow = {
  id: string;
  title: string | null;

  tournament_date: string | null; // YYYY-MM-DD
  min_teams: number | null;
  max_teams: number | null;

  start_time: string | null; // HH:MM
  end_time: string | null; // HH:MM

  match_duration_min: number | null;
  rotation_duration_min: number | null;

  num_fields: number | null;
  field_names: string[] | null;

  min_players_per_team: number | null;
  max_players_per_team: number | null;

  format: string | null;
  group_count: number | null;
  group_names: string[] | null;

  pauses: any | null; // TournamentPause[]
  field_pauses: any | null; // Record<string, Pause[]>
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

export default function TournamentSettingsPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = String(params.id);

  const [status, setStatus] = useState("Chargement...");
  const [saving, setSaving] = useState(false);

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

  // Format / Poules
  const [format, setFormat] = useState("round_robin"); // round_robin | groups_round_robin
  const [groupCount, setGroupCount] = useState("1");
  const [groupNames, setGroupNames] = useState<string[]>(["Poule 1"]);

  // ✅ Pauses: UI simplifiée
  const [pausesEnabled, setPausesEnabled] = useState(false);

  // pauses par terrain: { "1": [{from,to}], "2": [...] }
  const [fieldPauses, setFieldPauses] = useState<Record<string, Pause[]>>({});

  const fieldCount = useMemo(() => Math.max(1, clampInt(numFields, 1)), [numFields]);
  const groupsN = useMemo(() => Math.max(1, Math.min(8, clampInt(groupCount, 1))), [groupCount]);

  // Maintenir fieldNames à la bonne taille
  useEffect(() => {
    setFieldNames((prev) => {
      const next = [...prev];
      while (next.length < fieldCount) next.push(`Terrain ${next.length + 1}`);
      while (next.length > fieldCount) next.pop();
      return next;
    });
  }, [fieldCount]);

  // Maintenir groupNames à la bonne taille
  useEffect(() => {
    setGroupNames((prev) => {
      const next = [...prev];
      while (next.length < groupsN) next.push(`Poule ${next.length + 1}`);
      while (next.length > groupsN) next.pop();
      return next;
    });
  }, [groupsN]);

  // Maintenir fieldPauses à la bonne taille
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
          "id,title,tournament_date,min_teams,max_teams,start_time,end_time,match_duration_min,rotation_duration_min,num_fields,field_names,min_players_per_team,max_players_per_team,format,group_count,group_names,pauses,field_pauses"
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

      setFormat(row.format ?? "round_robin");
      setGroupCount(String(row.group_count ?? 1));
      setGroupNames(row.group_names && row.group_names.length ? row.group_names : ["Poule 1"]);

      // ✅ Hydrater pauses par terrain depuis DB
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

      // ✅ Activer si au moins une pause existe (field_pauses) OU anciennes pauses globales existent
      const pausesLegacy = safeArray<TournamentPause>(row.pauses);
      const legacyOn =
        pausesLegacy.some((p: any) => p?.type === "tournament" && isTime(p?.from) && isTime(p?.to)) ||
        pausesLegacy.some((p: any) => p?.type === "tournament_except" && isTime(p?.from) && isTime(p?.to));

      setPausesEnabled(legacyOn || hasAnyPause(normalized));

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

    // ✅ pauses: si activées, valider format & cohérence
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

    // ✅ Si pauses désactivées: vider complètement
    const finalFieldPauses = pausesEnabled ? fieldPauses : {};
    const finalPausesLegacy: TournamentPause[] = []; // on n’utilise plus les pauses legacy

    const payload: any = {
      title: clean(title),

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

      format: format || "round_robin",
      group_count: groupsN,
      group_names: groupNames.map((x) => clean(x) || "Poule"),

      // ✅ Persist pauses
      pauses: finalPausesLegacy,
      field_pauses: finalFieldPauses,
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
          {/* Infos principales */}
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
          </div>

          {/* Terrains */}
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

          {/* ✅ Pauses simplifiées */}
          <div className="border-t pt-4 space-y-3">
            <div className="font-semibold">Pauses</div>

            {/* Ligne unique */}
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

            {/* Bandeau déroulant */}
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

          {/* Format / Poules */}
          <div className="border-t pt-4 space-y-3">
            <div className="font-semibold">Format</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-gray-600">Format</label>
                <select className="w-full border rounded-lg p-2" value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="round_robin">Round Robin (tous ensemble)</option>
                  <option value="groups_round_robin">Poules (round robin)</option>
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {groupNames.map((n, i) => (
                <div key={i}>
                  <label className="text-sm text-gray-600">Nom poule {i + 1}</label>
                  <input className="w-full border rounded-lg p-2" value={n} onChange={(e) => updateGroupName(i, e.target.value)} />
                </div>
              ))}
            </div>
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