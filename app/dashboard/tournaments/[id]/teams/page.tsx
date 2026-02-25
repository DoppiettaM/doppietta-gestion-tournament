"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type TournamentRow = {
  id: string;
  title: string | null;
  max_teams: number | null;

  format: string | null; // "round_robin" | "groups_round_robin"
  group_count: number | null; // 1..8
  group_names: string[] | null;
};

type TeamRow = {
  id: string;
  name: string | null;
  email: string | null;
  colors: string[] | null;
  jersey_style: number | null;
  logo_svg: string | null;
  jersey_svg: string | null;

  group_idx: number | null; // 1..group_count
  group_manual: boolean | null; // false => "restante"

  created_at?: string | null;
};

const COLOR_PALETTE: { key: string; label: string; hex: string }[] = [
  { key: "red", label: "Rouge", hex: "#EF4444" },
  { key: "blue", label: "Bleu", hex: "#2563EB" },
  { key: "sky", label: "Bleu ciel", hex: "#38BDF8" },
  { key: "navy", label: "Bleu marine", hex: "#0F172A" },
  { key: "white", label: "Blanc", hex: "#FFFFFF" },
  { key: "gray", label: "Gris", hex: "#9CA3AF" },
  { key: "black", label: "Noir", hex: "#111827" },
  { key: "yellow", label: "Jaune", hex: "#FBBF24" },
  { key: "neonYellow", label: "Jaune fluo", hex: "#EFFF3A" },
  { key: "beige", label: "Beige", hex: "#E7DCC8" },
  { key: "orange", label: "Orange", hex: "#FB923C" },
  { key: "brown", label: "Marron", hex: "#8B5E34" },
  { key: "green", label: "Vert", hex: "#22C55E" },
  { key: "neonGreen", label: "Vert fluo", hex: "#39FF88" },
  { key: "pink", label: "Rose", hex: "#FB7185" },
  { key: "violet", label: "Violet", hex: "#8B5CF6" },
];

function clean(s: string) {
  return (s ?? "").trim();
}

function chooseColors(selectedHex: string[]) {
  const base = selectedHex.filter(Boolean).slice(0, 3);
  if (base.length === 0) return ["#2563EB", "#EF4444", "#FFFFFF"];
  if (base.length === 1) return [base[0], "#FFFFFF", "#111827"];
  if (base.length === 2) return [base[0], base[1], "#FFFFFF"];
  return base;
}

function initials(name: string) {
  const parts = clean(name).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "CLUB";
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function genLogoSvg(teamName: string, colorsHex: string[]) {
  const [c1, c2, c3] = chooseColors(colorsHex);
  const label = initials(teamName);
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220" viewBox="0 0 220 220">
  <defs>
    <linearGradient id="g" x1="0" x2="1">
      <stop offset="0" stop-color="${c1}"/>
      <stop offset="1" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect width="220" height="220" rx="28" fill="url(#g)"/>
  <path d="M110 30 C145 30 170 55 170 90 v40 c0 35-25 60-60 70 c-35-10-60-35-60-70 V90 c0-35 25-60 60-60z"
        fill="${c3}" opacity="0.92"/>
  <text x="110" y="128" text-anchor="middle" font-family="system-ui, -apple-system" font-size="44" font-weight="800" fill="${c2}">
    ${label}
  </text>
</svg>`.trim();
}

function genJerseySvg(style: number, colorsHex: string[]) {
  const [c1, c2, c3] = chooseColors(colorsHex);
  const s = Number(style || 1);

  const base = `
<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180">
  <path d="M60 30 L85 20 H95 L120 30 L145 45 L135 70 L125 60 V150 H55 V60 L45 70 L35 45 Z" fill="${c1}" stroke="#0B1220" stroke-opacity="0.25" stroke-width="2"/>
  <path d="M78 22 C82 35 98 35 102 22" fill="none" stroke="${c3}" stroke-width="6" stroke-linecap="round"/>
  <!-- BODY_DECOR -->
</svg>`.trim();

  let decor = "";

  if (s === 1) {
    decor = `
<rect x="67" y="35" width="10" height="115" fill="${c2}" opacity="0.95"/>
<rect x="87" y="35" width="10" height="115" fill="${c2}" opacity="0.95"/>
<rect x="107" y="35" width="10" height="115" fill="${c2}" opacity="0.95"/>`;
  } else if (s === 2) {
    decor = `
<rect x="52" y="55" width="76" height="14" fill="${c2}" opacity="0.95"/>
<rect x="52" y="85" width="76" height="14" fill="${c2}" opacity="0.95"/>
<rect x="52" y="115" width="76" height="14" fill="${c2}" opacity="0.95"/>`;
  } else if (s === 3) {
    decor = `
<path d="M52 130 L128 45 L128 65 L52 150 Z" fill="${c2}" opacity="0.95"/>
<path d="M52 110 L128 25 L128 35 L52 120 Z" fill="${c3}" opacity="0.65"/>`;
  } else if (s === 4) {
    decor = `<path d="M90 30 V150 H55 V60 L45 70 L35 45 L60 30 Z" fill="${c2}" opacity="0.95"/>`;
  } else {
    decor = `
<path d="M60 30 L85 20 H95 L120 30" fill="${c2}" opacity="0.95"/>
<path d="M35 45 L60 30 L72 36 L52 60 L45 70 Z" fill="${c2}" opacity="0.9"/>
<path d="M145 45 L120 30 L108 36 L128 60 L135 70 Z" fill="${c2}" opacity="0.9"/>
<rect x="55" y="95" width="70" height="10" fill="${c3}" opacity="0.7"/>`;
  }

  return base.replace("<!-- BODY_DECOR -->", decor);
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default function TeamsPage() {
  const router = useRouter();
  const params = useParams();
  const tournamentId = String(params.id);

  const [status, setStatus] = useState("Chargement...");
  const [tournament, setTournament] = useState<TournamentRow | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [selectedColors, setSelectedColors] = useState<string[]>([]);
  const [jerseyStyle, setJerseyStyle] = useState<number>(1);
  const [logoSvg, setLogoSvg] = useState<string>("");

  const [busy, setBusy] = useState(false);
  const [busyAuto, setBusyAuto] = useState(false);
  const [busyTeam, setBusyTeam] = useState<Record<string, boolean>>({});

  const maxTeams = useMemo(() => {
    const v = tournament?.max_teams;
    if (typeof v === "number" && v > 0) return v;
    return 24;
  }, [tournament]);

  const showGroups = useMemo(() => (tournament?.format ?? "") === "groups_round_robin", [tournament]);

  const groupCount = useMemo(() => {
    const n = Number(tournament?.group_count ?? 1);
    return clampInt(n, 1, 8);
  }, [tournament]);

  const groupNames = useMemo(() => {
    const raw = tournament?.group_names ?? [];
    const out: string[] = [];
    for (let i = 1; i <= groupCount; i++) {
      const nm = String(raw[i - 1] ?? "").trim();
      out.push(nm || `Poule ${i}`);
    }
    return out;
  }, [tournament, groupCount]);

  const remainingCount = useMemo(() => teams.filter((t) => !(t.group_manual ?? false)).length, [teams]);

  const previewLogo = useMemo(() => {
    const t = clean(name) || "Équipe";
    return logoSvg || genLogoSvg(t, selectedColors);
  }, [logoSvg, name, selectedColors]);

  const previewJersey = useMemo(() => genJerseySvg(jerseyStyle, selectedColors), [jerseyStyle, selectedColors]);

  useEffect(() => {
    async function load() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return router.push("/login");

      const { data: tData, error: tErr } = await supabase
        .from("tournaments")
        .select("id,title,max_teams,format,group_count,group_names")
        .eq("id", tournamentId)
        .single();

      if (tErr) {
        setStatus("Erreur tournoi: " + tErr.message);
        return;
      }

      setTournament((tData ?? null) as any);
      await refreshTeams();
      setStatus("");
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, tournamentId]);

  async function refreshTeams() {
    const { data, error } = await supabase
      .from("teams")
      .select("id,name,email,colors,logo_svg,jersey_style,jersey_svg,group_idx,group_manual,created_at")
      .eq("tournament_id", tournamentId)
      .order("created_at", { ascending: true });

    if (error) {
      setStatus("Erreur chargement équipes: " + error.message);
      return;
    }

    setTeams((data ?? []) as any);
  }

  function toggleColor(hex: string) {
    setSelectedColors((prev) => {
      const has = prev.includes(hex);
      let next = has ? prev.filter((c) => c !== hex) : [...prev, hex];
      next = next.slice(0, 3);
      return next;
    });
  }

  async function onUploadLogo(file: File) {
    const txt = await file.text();
    if (!txt.trim().startsWith("<svg")) {
      setStatus("⚠️ Upload logo: merci d’envoyer un SVG.");
      return;
    }
    setLogoSvg(txt);
  }

  async function addTeam() {
    const n = clean(name);
    const e = clean(email);

    if (!n) return setStatus("⚠️ Nom d’équipe obligatoire.");
    if (teams.length >= maxTeams) return setStatus(`⚠️ Limite atteinte: ${maxTeams} équipes max.`);

    setBusy(true);
    setStatus("");

    const finalLogo = logoSvg || genLogoSvg(n, selectedColors);
    const finalJersey = genJerseySvg(jerseyStyle, selectedColors);

    const payload: any = {
      tournament_id: tournamentId,
      name: n,
      email: e || null,
      colors: selectedColors.slice(0, 3),
      logo_svg: finalLogo,
      jersey_style: jerseyStyle,
      jersey_svg: finalJersey,
    };

    if (showGroups) {
      payload.group_idx = 1;
      payload.group_manual = false;
    }

    const { error } = await supabase.from("teams").insert(payload);

    if (error) {
      setStatus("Erreur ajout équipe: " + error.message);
      setBusy(false);
      return;
    }

    setName("");
    setEmail("");
    setSelectedColors([]);
    setJerseyStyle(1);
    setLogoSvg("");

    await refreshTeams();
    setBusy(false);
  }

  async function deleteTeam(teamId: string) {
    const ok = window.confirm("Supprimer cette équipe ?");
    if (!ok) return;

    setBusy(true);
    setStatus("");

    const { error } = await supabase.from("teams").delete().eq("id", teamId);

    if (error) {
      setStatus("Erreur suppression équipe: " + error.message);
      setBusy(false);
      return;
    }

    await refreshTeams();
    setBusy(false);
  }

  async function setTeamGroup(teamId: string, groupIdx: number) {
    const idx = clampInt(Number(groupIdx), 1, groupCount);

    setBusyTeam((p) => ({ ...p, [teamId]: true }));
    setStatus("");

    const { error } = await supabase.from("teams").update({ group_idx: idx, group_manual: true }).eq("id", teamId);

    if (error) {
      setStatus("Erreur attribution poule: " + error.message);
      setBusyTeam((p) => ({ ...p, [teamId]: false }));
      return;
    }

    setTeams((prev) => prev.map((t) => (t.id === teamId ? { ...t, group_idx: idx, group_manual: true } : t)));
    setBusyTeam((p) => ({ ...p, [teamId]: false }));
  }

  // ✅ FIX: plus d'UPSERT => batch d'UPDATE (comme le select manuel)
  async function autoAssignRemaining() {
    if (!showGroups) return setStatus("⚠️ Le tournoi n’est pas en mode poules.");

    const remaining = teams.filter((t) => !(t.group_manual ?? false));
    if (remaining.length === 0) return setStatus("Aucune équipe restante à répartir.");

    setBusyAuto(true);
    setStatus("");

    const list = shuffleInPlace([...remaining]);

    // Répartition équilibrée 1..groupCount
    const plan = list.map((t, i) => ({
      id: t.id,
      group_idx: (i % groupCount) + 1,
    }));

    // Batch d'updates
    for (const u of plan) {
      const { error } = await supabase
        .from("teams")
        .update({ group_idx: u.group_idx, group_manual: true })
        .eq("id", u.id);

      if (error) {
        setStatus("Erreur répartition auto: " + error.message);
        setBusyAuto(false);
        return;
      }
    }

    await refreshTeams();
    setBusyAuto(false);
    setStatus(`Répartition auto ✅ (${plan.length} équipes)`);
  }

  function groupLabel(team: TeamRow) {
    const idx = clampInt(Number(team.group_idx ?? 1), 1, groupCount);
    return groupNames[idx - 1] ?? `Poule ${idx}`;
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="bg-white rounded-xl shadow p-6 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Équipes</h1>
            <p className="text-sm text-gray-500">
              Tournoi: <span className="font-semibold">{tournament?.title ?? tournamentId}</span>
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {teams.length} / {maxTeams} équipes
              {showGroups && (
                <>
                  {" "}
                  · Poules: <span className="font-semibold">{groupCount}</span> · Restantes:{" "}
                  <span className="font-semibold">{remainingCount}</span>
                </>
              )}
            </p>
            {status && <p className="text-sm text-amber-700 mt-2">{status}</p>}
          </div>

          <div className="flex gap-2 flex-wrap items-center">
            <button
              onClick={() => router.push(`/dashboard/tournaments/${tournamentId}`)}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
            >
              ← Retour
            </button>
            <button
              onClick={refreshTeams}
              className="bg-gray-200 px-4 py-2 rounded-lg hover:bg-gray-300 transition"
              title="Rafraîchir"
            >
              🔄
            </button>

            {showGroups && (
              <button
                onClick={autoAssignRemaining}
                disabled={busyAuto}
                className="bg-black text-white px-4 py-2 rounded-lg hover:bg-gray-900 transition disabled:opacity-50"
                title="Attribue au hasard une poule aux équipes non attribuées manuellement"
              >
                {busyAuto ? "🎲 ..." : "🎲 Répartition auto des équipes restantes"}
              </button>
            )}
          </div>
        </div>

        {/* AJOUT */}
        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <h2 className="font-semibold">Ajouter une équipe</h2>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className="space-y-3">
              <input
                className="border rounded-lg px-3 py-2 w-full"
                placeholder="Nom de l’équipe (obligatoire)"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />

              <input
                className="border rounded-lg px-3 py-2 w-full"
                placeholder="Email (optionnel)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />

              <div>
                <div className="text-sm font-semibold mb-2">Couleurs (1 à 3)</div>
                <div className="grid grid-cols-4 gap-2">
                  {COLOR_PALETTE.map((c) => {
                    const on = selectedColors.includes(c.hex);
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => toggleColor(c.hex)}
                        className={`border rounded-lg px-2 py-2 text-xs flex items-center gap-2 ${
                          on ? "ring-2 ring-black" : ""
                        }`}
                        title={c.label}
                      >
                        <span
                          className="inline-block w-4 h-4 rounded"
                          style={{ background: c.hex, border: "1px solid rgba(0,0,0,0.15)" }}
                        />
                        <span className="truncate">{c.label}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="text-xs text-gray-500 mt-2">Sélection: {selectedColors.length}/3</div>
              </div>

              <div>
                <div className="text-sm font-semibold mb-2">Style de maillot</div>
                <div className="grid grid-cols-5 gap-2">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setJerseyStyle(s)}
                      className={`border rounded-lg px-2 py-2 text-sm ${
                        jerseyStyle === s ? "bg-black text-white" : "bg-white"
                      }`}
                      title={`Style ${s}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              <div className="border rounded-lg p-3 bg-slate-50">
                <div className="text-sm font-semibold mb-2">Logo</div>

                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setLogoSvg(genLogoSvg(clean(name) || "Équipe", selectedColors))}
                    className="bg-black text-white px-3 py-2 rounded-lg hover:bg-gray-900 transition text-sm"
                  >
                    ✨ Générer
                  </button>

                  <label className="bg-gray-200 px-3 py-2 rounded-lg hover:bg-gray-300 transition text-sm cursor-pointer">
                    ⬆️ Upload SVG
                    <input
                      type="file"
                      accept=".svg,image/svg+xml"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) onUploadLogo(f);
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => setLogoSvg("")}
                    className="bg-gray-200 px-3 py-2 rounded-lg hover:bg-gray-300 transition text-sm"
                    title="Revenir au logo standard auto"
                  >
                    ↩️ Standard
                  </button>
                </div>

                <div className="text-xs text-gray-500 mt-2">
                  Si aucun logo, un logo standard est généré automatiquement avec les couleurs.
                </div>
              </div>

              <button
                onClick={addTeam}
                disabled={busy}
                className="bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 transition disabled:opacity-50 w-full"
              >
                {busy ? "..." : "➕ Ajouter l’équipe"}
              </button>

              {showGroups && <div className="text-xs text-gray-500">Une équipe est “restante” tant que sa poule n’a pas été choisie manuellement.</div>}
            </div>

            <div className="bg-slate-50 border rounded-xl p-4 space-y-3">
              <div className="text-sm font-semibold">Aperçu</div>

              <div className="flex items-center gap-3">
                <div className="w-20 h-20 rounded-xl overflow-hidden bg-white border flex items-center justify-center" dangerouslySetInnerHTML={{ __html: previewLogo }} />
                <div>
                  <div className="font-bold text-lg">{clean(name) || "Nom d’équipe"}</div>
                  <div className="text-sm text-gray-600">{clean(email) || "email@exemple.fr"}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    Couleurs: {selectedColors.length ? selectedColors.join(", ") : "défaut Doppietta"}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="w-24 h-24 rounded-xl overflow-hidden bg-white border flex items-center justify-center" dangerouslySetInnerHTML={{ __html: previewJersey }} title="Maillot" />
                <div className="text-sm text-gray-700">
                  <div className="font-semibold">Maillot style {jerseyStyle}</div>
                  <div className="text-xs text-gray-500">Reporté sur la feuille de présence.</div>
                </div>
              </div>
            </div>

            <div className="bg-white border rounded-xl p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="font-semibold">Liste des équipes</div>

                {showGroups && (
                  <div className="text-xs text-gray-500">
                    Poules: {groupCount} · Restantes: <span className="font-semibold">{remainingCount}</span>
                  </div>
                )}
              </div>

              {teams.length === 0 ? (
                <div className="text-gray-600">Aucune équipe pour l’instant.</div>
              ) : (
                <div className="space-y-2">
                  {teams.map((t, idx) => {
                    const manual = Boolean(t.group_manual);
                    const gIdx = clampInt(Number(t.group_idx ?? 1), 1, groupCount);

                    return (
                      <div key={t.id} className="border rounded-lg px-3 py-2 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-10 h-10 rounded-lg overflow-hidden bg-white border flex items-center justify-center shrink-0"
                            dangerouslySetInnerHTML={{ __html: t.logo_svg || genLogoSvg(t.name ?? "Équipe", t.colors ?? []) }}
                          />
                          <div className="min-w-0">
                            <div className="font-semibold truncate">
                              {idx + 1}. {t.name ?? "Équipe"}
                            </div>
                            <div className="text-xs text-gray-500 truncate">{t.email ?? "—"}</div>

                            {showGroups && (
                              <div className="mt-1 flex items-center gap-2 flex-wrap">
                                <span
                                  className={`text-xs font-semibold px-2 py-0.5 rounded ${
                                    manual ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                                  }`}
                                  title={manual ? "Attribuée manuellement" : "Restante (auto possible)"}
                                >
                                  {manual ? "✅ Attribuée" : "⏳ Restante"}
                                </span>
                                <span className="text-xs text-gray-600">{groupLabel(t)}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex gap-2 shrink-0 items-center flex-wrap justify-end">
                          {showGroups && (
                            <select
                              className="border rounded-lg px-2 py-2 bg-white text-sm"
                              value={gIdx}
                              disabled={Boolean(busyTeam[t.id])}
                              onChange={(e) => setTeamGroup(t.id, Number(e.target.value))}
                              title="Attribuer une poule (manuelle)"
                            >
                              {Array.from({ length: groupCount }, (_, i) => (
                                <option key={i + 1} value={i + 1}>
                                  {groupNames[i] ?? `Poule ${i + 1}`}
                                </option>
                              ))}
                            </select>
                          )}

                          <button
                            onClick={() => router.push(`/dashboard/tournaments/${tournamentId}/teams/${t.id}/sheet`)}
                            className="bg-gray-200 px-3 py-2 rounded-lg hover:bg-gray-300 transition text-sm"
                            title="Feuille de présence"
                          >
                            🧾
                          </button>

                          <button
                            onClick={() => deleteTeam(t.id)}
                            disabled={busy}
                            className="bg-red-600 text-white px-3 py-2 rounded-lg hover:bg-red-700 transition text-sm disabled:opacity-50"
                            title="Supprimer"
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="text-xs text-gray-400 mt-3">
                Les couleurs/logo/maillot sont enregistrés et seront utilisés sur la feuille de présence.
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}