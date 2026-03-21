"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type TournamentRow = {
  id: string;
  title: string | null;
  created_at: string | null;
  tournament_date: string | null;
  max_players_per_team: number | null;
};

type TeamRow = {
  id: string;
  name: string | null;
  email: string | null;
  colors: string[] | null;
  logo_svg: string | null;
  jersey_style: number | null;
  jersey_svg: string | null;
  staff: any[] | null;
};

type PlayerRow = {
  id: string;
  team_id: string;
  first_name: string | null;
  last_name: string | null;
  jersey_number: number | null;
  license_number: string | null;
  birth_date?: string | null;
};

type StaffRow = {
  first_name: string;
  last_name: string;
  license_number: string;
  no_license: boolean;
  birth_date: string;
  phone: string;
};

type PlayerForm = {
  id?: string;
  jersey_number: string;
  last_name: string;
  first_name: string;
  license_number: string;
  no_license: boolean;
  birth_date: string;
};

function clean(s: string) {
  return (s ?? "").trim();
}

function safeParseDate(iso: string | null | undefined) {
  if (!iso) return null;

  const s = String(iso).trim();

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    return new Date(y, mo - 1, d);
  }

  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

function prettyDateFR(d: Date | null) {
  if (!d) return "";
  return d.toLocaleDateString("fr-FR");
}

function chooseColors(colors: string[] | null) {
  const base = (colors ?? []).filter(Boolean).slice(0, 3);
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

function genFallbackLogo(teamName: string, colors: string[] | null) {
  const [c1, c2, c3] = chooseColors(colors);
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
  <circle cx="110" cy="110" r="74" fill="${c3}" opacity="0.92"/>
  <text x="110" y="126" text-anchor="middle" font-family="system-ui, -apple-system" font-size="44" font-weight="800" fill="${c2}">
    ${label}
  </text>
</svg>`.trim();
}

async function svgToPngDataUrl(svg: string, size = 256): Promise<string | null> {
  try {
    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.crossOrigin = "anonymous";

    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });

    URL.revokeObjectURL(url);
    if (!loaded) return null;

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);

    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function emptyPlayerForm(): PlayerForm {
  return {
    jersey_number: "",
    last_name: "",
    first_name: "",
    license_number: "",
    no_license: false,
    birth_date: "",
  };
}

function hasAnyPlayerData(p: PlayerForm) {
  return (
    clean(p.jersey_number) ||
    clean(p.last_name) ||
    clean(p.first_name) ||
    clean(p.license_number) ||
    clean(p.birth_date)
  );
}

function normalizeBirthDateToISO(input: string): string | null | undefined {
  const s = clean(input);
  if (!s) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/;
  const mIso = s.match(iso);
  if (mIso) {
    const y = Number(mIso[1]);
    const mo = Number(mIso[2]);
    const d = Number(mIso[3]);
    if (y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return s;
    return undefined;
  }

  const fr = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;
  const mFr = s.match(fr);
  if (mFr) {
    const d = Number(mFr[1]);
    const mo = Number(mFr[2]);
    const y = Number(mFr[3]);
    if (!(y >= 1900 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return undefined;
    const dd = String(d).padStart(2, "0");
    const mm = String(mo).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  }

  return undefined;
}

function displayBirthDate(input: string | null | undefined) {
  const s = clean(input ?? "");
  if (!s) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/;
  const m = s.match(iso);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function getPublicSupabase(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Variables Supabase manquantes côté client.");
  }

  return createClient(url, anonKey, {
    global: {
      headers: token ? { "x-team-sheet-token": token } : {},
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export default function PublicTeamSheetPage() {
  const params = useParams();
  const searchParams = useSearchParams();

  const tournamentId = String(params.id);
  const teamId = String(params.teamId);
  const token = clean(searchParams.get("token") ?? "");

  const [status, setStatus] = useState("Chargement...");
  const [tournament, setTournament] = useState<TournamentRow | null>(null);
  const [team, setTeam] = useState<TeamRow | null>(null);

  const [playersFromDb, setPlayersFromDb] = useState<PlayerRow[]>([]);
  const [playerForms, setPlayerForms] = useState<PlayerForm[]>([]);
  const [supportsBirthDate, setSupportsBirthDate] = useState(true);

  const [staff, setStaff] = useState<StaffRow[]>(
    Array.from({ length: 5 }).map(() => ({
      first_name: "",
      last_name: "",
      license_number: "",
      no_license: false,
      birth_date: "",
      phone: "",
    }))
  );

  const [busySaveStaff, setBusySaveStaff] = useState(false);
  const [busySavePlayers, setBusySavePlayers] = useState(false);
  const [busyPdf, setBusyPdf] = useState(false);

  const publicSupabase = useMemo(() => {
    if (!token) return null;
    try {
      return getPublicSupabase(token);
    } catch {
      return null;
    }
  }, [token]);

  const maxPlayers = useMemo(() => {
    const v = tournament?.max_players_per_team;
    if (typeof v === "number" && v > 0) return v;
    return 7;
  }, [tournament]);

  const colors = useMemo(() => chooseColors(team?.colors ?? null), [team?.colors]);
  const [c1, c2, c3] = colors;

  const tournamentDate = useMemo(() => {
    const d = safeParseDate(tournament?.tournament_date ?? null);
    return prettyDateFR(d);
  }, [tournament]);

  const logoSvg = useMemo(() => {
    if (!team) return "";
    return team.logo_svg || genFallbackLogo(team.name ?? "Équipe", team.colors ?? null);
  }, [team]);

  const jerseySvg = useMemo(() => team?.jersey_svg || "", [team]);

  function ensureFormsLength(forms: PlayerForm[], n: number) {
    const next = [...forms];
    while (next.length < n) next.push(emptyPlayerForm());
    return next.slice(0, n);
  }

  useEffect(() => {
    async function load() {
      if (!token) {
        setStatus("Lien invalide : token manquant.");
        return;
      }

      if (!publicSupabase) {
        setStatus("Configuration publique indisponible.");
        return;
      }

      setStatus("Chargement...");

      const tRes = await publicSupabase
        .from("tournaments")
        .select("id,title,created_at,tournament_date,max_players_per_team")
        .eq("id", tournamentId)
        .single();

      if (tRes.error) {
        setStatus("Erreur tournoi: " + tRes.error.message);
        return;
      }

      const teamRes = await publicSupabase
        .from("teams")
        .select("id,name,email,colors,logo_svg,jersey_style,jersey_svg,staff")
        .eq("id", teamId)
        .single();

      if (teamRes.error) {
        setStatus("Erreur équipe: " + teamRes.error.message);
        return;
      }

      let pRes: any = await publicSupabase
        .from("players")
        .select("id,team_id,first_name,last_name,jersey_number,license_number,birth_date")
        .eq("tournament_id", tournamentId)
        .eq("team_id", teamId)
        .order("jersey_number", { ascending: true });

      if (
        pRes.error &&
        String(pRes.error.message).includes("column") &&
        String(pRes.error.message).toLowerCase().includes("birth")
      ) {
        setSupportsBirthDate(false);
        pRes = await publicSupabase
          .from("players")
          .select("id,team_id,first_name,last_name,jersey_number,license_number")
          .eq("tournament_id", tournamentId)
          .eq("team_id", teamId)
          .order("jersey_number", { ascending: true });
      } else {
        setSupportsBirthDate(true);
      }

      if (pRes.error) {
        setStatus("Erreur joueurs: " + pRes.error.message);
        return;
      }

      const tRow = (tRes.data ?? null) as TournamentRow;
      const teamRow = (teamRes.data ?? null) as TeamRow;
      const pRows = ((pRes.data ?? []) as any) as PlayerRow[];

      setTournament(tRow);
      setTeam(teamRow);
      setPlayersFromDb(pRows);

      const forms: PlayerForm[] = pRows.map((p) => ({
        id: p.id,
        jersey_number: p.jersey_number != null ? String(p.jersey_number) : "",
        last_name: p.last_name ?? "",
        first_name: p.first_name ?? "",
        license_number: p.license_number ?? "",
        no_license: !clean(p.license_number ?? ""),
        birth_date: displayBirthDate((p as any)?.birth_date ?? ""),
      }));

      setPlayerForms(
        ensureFormsLength(
          forms,
          tRow.max_players_per_team && tRow.max_players_per_team > 0
            ? tRow.max_players_per_team
            : 7
        )
      );

      const sArr = (teamRes.data as any)?.staff;
      if (Array.isArray(sArr)) {
        const next = Array.from({ length: 5 }).map((_, i) => {
          const x = sArr[i] || {};
          return {
            first_name: x.first_name || "",
            last_name: x.last_name || "",
            license_number: x.license_number || "",
            no_license: Boolean(x.no_license),
            birth_date: x.birth_date || "",
            phone: x.phone || "",
          } as StaffRow;
        });
        setStaff(next);
      }

      setStatus("");
    }

    load();
  }, [publicSupabase, token, tournamentId, teamId]);

  useEffect(() => {
    setPlayerForms((prev) => ensureFormsLength(prev, maxPlayers));
  }, [maxPlayers]);

  function setStaffField(i: number, k: keyof StaffRow, v: any) {
    setStaff((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [k]: v };
      if (k === "no_license" && v === true) next[i].license_number = "";
      return next;
    });
  }

  function setPlayerField(i: number, k: keyof PlayerForm, v: any) {
    setPlayerForms((prev) => {
      const next = [...prev];
      const row = { ...next[i] };
      (row as any)[k] = v;
      if (k === "no_license" && v === true) row.license_number = "";
      next[i] = row;
      return next;
    });
  }

  async function reloadPlayers() {
    if (!publicSupabase) return;

    let pRes: any = await publicSupabase
      .from("players")
      .select("id,team_id,first_name,last_name,jersey_number,license_number,birth_date")
      .eq("tournament_id", tournamentId)
      .eq("team_id", teamId)
      .order("jersey_number", { ascending: true });

    if (
      pRes.error &&
      String(pRes.error.message).includes("column") &&
      String(pRes.error.message).toLowerCase().includes("birth")
    ) {
      setSupportsBirthDate(false);
      pRes = await publicSupabase
        .from("players")
        .select("id,team_id,first_name,last_name,jersey_number,license_number")
        .eq("tournament_id", tournamentId)
        .eq("team_id", teamId)
        .order("jersey_number", { ascending: true });
    } else {
      setSupportsBirthDate(true);
    }

    if (pRes.error) {
      setStatus("Erreur reload joueurs: " + pRes.error.message);
      return;
    }

    const pRows = ((pRes.data ?? []) as any) as PlayerRow[];
    setPlayersFromDb(pRows);

    const forms: PlayerForm[] = pRows.map((p) => ({
      id: p.id,
      jersey_number: p.jersey_number != null ? String(p.jersey_number) : "",
      last_name: p.last_name ?? "",
      first_name: p.first_name ?? "",
      license_number: p.license_number ?? "",
      no_license: !clean(p.license_number ?? ""),
      birth_date: displayBirthDate((p as any)?.birth_date ?? ""),
    }));

    setPlayerForms((prev) =>
      prev.some(hasAnyPlayerData) ? prev : ensureFormsLength(forms, maxPlayers)
    );
  }

  async function saveStaff() {
    if (!team || !publicSupabase) return;
    setBusySaveStaff(true);
    setStatus("");

    const payload = staff.map((s) => ({
      first_name: clean(s.first_name),
      last_name: clean(s.last_name),
      license_number: clean(s.license_number),
      no_license: Boolean(s.no_license),
      birth_date: clean(s.birth_date),
      phone: clean(s.phone),
    }));

    const { error } = await publicSupabase
      .from("teams")
      .update({ staff: payload })
      .eq("id", teamId);

    if (error) {
      setStatus("Erreur sauvegarde encadrement: " + error.message);
      setBusySaveStaff(false);
      return;
    }

    setStatus("✅ Encadrement sauvegardé.");
    setBusySaveStaff(false);
    setTimeout(() => setStatus(""), 1200);
  }

  async function savePlayers() {
    if (!publicSupabase) return;

    setBusySavePlayers(true);
    setStatus("");

    const updates: any[] = [];
    const inserts: any[] = [];

    for (let idx = 0; idx < playerForms.length; idx++) {
      const row = playerForms[idx];

      if (!hasAnyPlayerData(row) && !row.id) continue;

      const jerseyNum = clean(row.jersey_number) ? Number(row.jersey_number) : null;

      const payloadBase: any = {
        tournament_id: tournamentId,
        team_id: teamId,
        jersey_number: Number.isFinite(jerseyNum as any) ? jerseyNum : null,
        last_name: clean(row.last_name) || null,
        first_name: clean(row.first_name) || null,
        license_number: row.no_license ? null : clean(row.license_number) || null,
      };

      if (supportsBirthDate) {
        const iso = normalizeBirthDateToISO(row.birth_date);
        if (iso === undefined) {
          setStatus(`⚠️ Date joueur ligne ${idx + 1} invalide. Format attendu: JJ/MM/AAAA`);
          setBusySavePlayers(false);
          return;
        }
        payloadBase.birth_date = iso;
      }

      if (row.id) updates.push({ id: row.id, ...payloadBase });
      else inserts.push(payloadBase);
    }

    if (updates.length > 0) {
      const { error: upErr } = await publicSupabase
        .from("players")
        .upsert(updates, { onConflict: "id" });

      if (upErr) {
        const msg = String(upErr.message || "");
        if (msg.includes("column") && msg.toLowerCase().includes("birth")) {
          setSupportsBirthDate(false);
          const stripped = updates.map(({ birth_date, ...rest }) => rest);
          const { error: upErr2 } = await publicSupabase
            .from("players")
            .upsert(stripped, { onConflict: "id" });

          if (upErr2) {
            setStatus("Erreur sauvegarde joueurs: " + upErr2.message);
            setBusySavePlayers(false);
            return;
          }
        } else {
          setStatus("Erreur sauvegarde joueurs: " + upErr.message);
          setBusySavePlayers(false);
          return;
        }
      }
    }

    if (inserts.length > 0) {
      const { error: inErr } = await publicSupabase
        .from("players")
        .insert(inserts);

      if (inErr) {
        const msg = String(inErr.message || "");
        if (msg.includes("column") && msg.toLowerCase().includes("birth")) {
          setSupportsBirthDate(false);
          const stripped = inserts.map(({ birth_date, ...rest }: any) => rest);
          const { error: inErr2 } = await publicSupabase
            .from("players")
            .insert(stripped);

          if (inErr2) {
            setStatus("Erreur insert joueurs: " + inErr2.message);
            setBusySavePlayers(false);
            return;
          }
        } else {
          setStatus("Erreur insert joueurs: " + inErr.message);
          setBusySavePlayers(false);
          return;
        }
      }
    }

    await reloadPlayers();
    setStatus("✅ Joueurs sauvegardés.");
    setBusySavePlayers(false);
    setTimeout(() => setStatus(""), 1200);
  }

  async function exportPdf() {
    if (!team || !tournament) return;
    setBusyPdf(true);
    setStatus("");

    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

    doc.setFillColor(c1);
    doc.rect(0, 0, 595, 92, "F");
    doc.setFillColor(c2);
    doc.rect(0, 92, 595, 6, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(tournament.title ?? "Tournoi", 40, 34);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(tournamentDate ? `Date: ${tournamentDate}` : "Date: —", 40, 56);

    doc.setTextColor(17, 24, 39);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text(team.name ?? "Équipe", 40, 126);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    if (team.email) doc.text(team.email, 40, 144);

    try {
      const logoPng = await svgToPngDataUrl(logoSvg, 256);
      if (logoPng) doc.addImage(logoPng, "PNG", 440, 18, 60, 60);

      if (jerseySvg) {
        const jerseyPng = await svgToPngDataUrl(jerseySvg, 256);
        if (jerseyPng) doc.addImage(jerseyPng, "PNG", 510, 18, 60, 60);
      }
    } catch {}

    const rowsPlayers = Array.from({ length: maxPlayers }).map((_, i) => {
      const p = playerForms[i] ?? emptyPlayerForm();
      const lic = p.no_license ? "Pas de licence" : clean(p.license_number);
      return [
        clean(p.jersey_number),
        clean(p.last_name),
        clean(p.first_name),
        lic,
        clean(p.birth_date),
      ];
    });

    autoTable(doc, {
      startY: 162,
      head: [["#", "Nom", "Prénom", "Licence", "Naissance"]],
      body: rowsPlayers,
      styles: { font: "helvetica", fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: [15, 23, 42] },
      alternateRowStyles: { fillColor: [245, 245, 245] },
    });

    const afterPlayersY = (doc as any).lastAutoTable?.finalY ?? 162;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Encadrement (jusqu’à 5)", 40, afterPlayersY + 28);

    const staffRows = staff.map((s) => [
      clean(s.last_name),
      clean(s.first_name),
      s.no_license ? "Pas de licence" : clean(s.license_number),
      clean(s.birth_date),
      clean(s.phone),
    ]);

    autoTable(doc, {
      startY: afterPlayersY + 38,
      head: [["Nom", "Prénom", "Licence", "Naissance", "Téléphone"]],
      body: staffRows,
      styles: { font: "helvetica", fontSize: 9, cellPadding: 5 },
      headStyles: { fillColor: [15, 23, 42] },
      alternateRowStyles: { fillColor: [245, 245, 245] },
    });

    doc.save(`fiche_presence_${team.name ?? "equipe"}.pdf`);
    setBusyPdf(false);
  }

  if (!token) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="max-w-5xl mx-auto bg-white rounded-xl shadow p-6 text-amber-700">
          Lien invalide : token manquant.
        </div>
      </main>
    );
  }

  if (!team || !tournament) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="max-w-5xl mx-auto bg-white rounded-xl shadow p-6">{status}</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div
          className="rounded-xl shadow p-6"
          style={{ background: `linear-gradient(135deg, ${c1}, ${c2})`, color: "white" }}
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-sm opacity-90 truncate">
                {tournament.title ?? "Tournoi"} {tournamentDate ? `· ${tournamentDate}` : ""}
              </div>
              <div className="text-xs opacity-90">
                brute tournament_date: {String(tournament?.tournament_date ?? "null")}
              </div>
              <div className="text-xs opacity-90">
                brute created_at: {String(tournament?.created_at ?? "null")}
              </div>
              <h1 className="text-2xl font-bold truncate">{team.name ?? "Équipe"}</h1>
              <div className="text-xs opacity-90 truncate">{team.email ?? ""}</div>
            </div>

            <div className="flex items-center gap-3">
              <div
                className="w-16 h-16 rounded-xl overflow-hidden bg-white/90 border border-white/30 flex items-center justify-center"
                dangerouslySetInnerHTML={{ __html: logoSvg }}
                title="Logo"
              />
              <div
                className="w-16 h-16 rounded-xl overflow-hidden bg-white/90 border border-white/30 flex items-center justify-center"
                dangerouslySetInnerHTML={{ __html: jerseySvg || "<div/>" }}
                title="Maillot"
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h2 className="font-semibold">Fiche équipe à compléter</h2>
              <div className="text-xs text-gray-500">
                Date acceptée : <span className="font-mono">JJ/MM/AAAA</span>
              </div>
              {!supportsBirthDate && (
                <div className="text-xs text-amber-700 mt-1">
                  ⚠️ La date de naissance n’est pas stockée en base actuellement.
                </div>
              )}
            </div>

            <div className="flex gap-2 flex-wrap">
              <button
                onClick={savePlayers}
                disabled={busySavePlayers}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
              >
                {busySavePlayers ? "..." : "💾 Sauvegarder joueurs"}
              </button>
              <button
                onClick={saveStaff}
                disabled={busySaveStaff}
                className="bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-black transition disabled:opacity-50"
              >
                {busySaveStaff ? "..." : "💾 Sauvegarder encadrement"}
              </button>
              <button
                onClick={exportPdf}
                disabled={busyPdf}
                className="bg-black text-white px-4 py-2 rounded-lg hover:bg-gray-900 transition disabled:opacity-50"
              >
                {busyPdf ? "..." : "🧾 PDF"}
              </button>
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <div className="grid grid-cols-12 text-xs font-semibold p-2" style={{ background: c3 }}>
              <div className="col-span-1">#</div>
              <div className="col-span-3">Nom</div>
              <div className="col-span-3">Prénom</div>
              <div className="col-span-3">Licence</div>
              <div className="col-span-2">Naissance</div>
            </div>

            {Array.from({ length: maxPlayers }).map((_, i) => {
              const p = playerForms[i] ?? emptyPlayerForm();

              return (
                <div key={i} className="grid grid-cols-12 p-2 text-sm border-t gap-2 items-start">
                  <input
                    className="col-span-1 border rounded px-2 py-2 text-sm"
                    placeholder="#"
                    value={p.jersey_number}
                    onChange={(e) => setPlayerField(i, "jersey_number", e.target.value)}
                  />

                  <input
                    className="col-span-3 border rounded px-2 py-2 text-sm"
                    placeholder="Nom"
                    value={p.last_name}
                    onChange={(e) => setPlayerField(i, "last_name", e.target.value)}
                  />

                  <input
                    className="col-span-3 border rounded px-2 py-2 text-sm"
                    placeholder="Prénom"
                    value={p.first_name}
                    onChange={(e) => setPlayerField(i, "first_name", e.target.value)}
                  />

                  <div className="col-span-3 space-y-1">
                    <input
                      className="border rounded px-2 py-2 text-sm w-full"
                      placeholder="N° licence"
                      value={p.license_number}
                      disabled={p.no_license}
                      onChange={(e) => setPlayerField(i, "license_number", e.target.value)}
                    />
                    <label className="text-xs text-gray-600 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={p.no_license}
                        onChange={(e) => setPlayerField(i, "no_license", e.target.checked)}
                      />
                      pas de licence
                    </label>
                  </div>

                  <input
                    className="col-span-2 border rounded px-2 py-2 text-sm"
                    placeholder="JJ/MM/AAAA"
                    value={p.birth_date}
                    onChange={(e) => setPlayerField(i, "birth_date", e.target.value)}
                  />
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow p-6 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold">Encadrement (jusqu’à 5)</h2>
          </div>

          <div className="text-xs text-gray-500">Licence : coche “pas de licence” si besoin.</div>

          <div className="space-y-2">
            {staff.map((s, i) => (
              <div key={i} className="border rounded-lg p-3">
                <div className="font-semibold text-sm mb-2">Staff #{i + 1}</div>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  <input
                    className="border rounded-lg px-2 py-2 text-sm"
                    placeholder="Nom"
                    value={s.last_name}
                    onChange={(e) => setStaffField(i, "last_name", e.target.value)}
                  />
                  <input
                    className="border rounded-lg px-2 py-2 text-sm"
                    placeholder="Prénom"
                    value={s.first_name}
                    onChange={(e) => setStaffField(i, "first_name", e.target.value)}
                  />

                  <div className="space-y-1">
                    <input
                      className="border rounded-lg px-2 py-2 text-sm w-full"
                      placeholder="N° licence"
                      value={s.license_number}
                      disabled={s.no_license}
                      onChange={(e) => setStaffField(i, "license_number", e.target.value)}
                    />
                    <label className="text-xs text-gray-600 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={s.no_license}
                        onChange={(e) => setStaffField(i, "no_license", e.target.checked)}
                      />
                      pas de licence
                    </label>
                  </div>

                  <input
                    className="border rounded-lg px-2 py-2 text-sm"
                    placeholder="Date de naissance"
                    value={s.birth_date}
                    onChange={(e) => setStaffField(i, "birth_date", e.target.value)}
                  />

                  <input
                    className="border rounded-lg px-2 py-2 text-sm"
                    placeholder="Téléphone"
                    value={s.phone}
                    onChange={(e) => setStaffField(i, "phone", e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>

          {status && <div className="text-sm text-amber-700">{status}</div>}
        </div>
      </div>
    </main>
  );
}