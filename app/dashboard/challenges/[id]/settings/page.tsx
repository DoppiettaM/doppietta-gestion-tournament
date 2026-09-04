"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type EventRow = { id?: string; title: string; start_time: string; duration_minutes: number; event_type: string; position: number };
const THEMES = ["blue", "red", "orange", "green", "yellow", "purple", "sky"];
const THEME_LABELS: Record<string, string> = { blue: "Bleu", red: "Rouge", orange: "Orange", green: "Vert", yellow: "Jaune", purple: "Violet", sky: "Bleu ciel" };

export default function ChallengeSettingsPage() {
  const router = useRouter(); const params = useParams(); const id = String(params.id);
  const [title, setTitle] = useState(""); const [date, setDate] = useState(""); const [venue, setVenue] = useState("");
  const [fields, setFields] = useState<string[]>(["Terrain 1", "Terrain 2", "Terrain 3", "Terrain 4"]);
  const [matchDuration, setMatchDuration] = useState(10); const [rotation, setRotation] = useState(3);
  const [theme, setTheme] = useState("blue"); const [logo, setLogo] = useState<string | null>(null); const [banners, setBanners] = useState<(string | null)[]>([null, null, null]);
  const [referees, setReferees] = useState<string[]>(Array.from({length:12},(_,i)=>`Arbitre ${i+1}`));
  const [roster, setRoster] = useState({minPlayers:6,maxPlayers:7,minStaff:1,maxStaff:5});
  const [events, setEvents] = useState<EventRow[]>([]); const [status, setStatus] = useState("Chargement..."); const [saving, setSaving] = useState(false);

  useEffect(() => { (async () => {
    const { data: auth } = await supabase.auth.getUser(); if (!auth.user) return router.push("/login");
    const [{ data: c, error }, { data: e }] = await Promise.all([
      supabase.from("challenges").select("title,event_date,venue,field_names,match_duration_min,rotation_duration_min,display_theme,display_logo_url,display_banners,referee_names,min_players_per_team,max_players_per_team,min_staff_per_team,max_staff_per_team").eq("id", id).single(),
      supabase.from("challenge_events").select("id,title,start_time,duration_minutes,event_type,position").eq("challenge_id", id).order("start_time").order("position")
    ]);
    if (error) return setStatus("Erreur: " + error.message);
    setTitle(c.title ?? ""); setDate(c.event_date ?? ""); setVenue(c.venue ?? ""); setFields(Array.isArray(c.field_names) && c.field_names.length ? c.field_names : fields);
    setMatchDuration(Number(c.match_duration_min ?? 10)); setRotation(Number(c.rotation_duration_min ?? 3)); setTheme(c.display_theme ?? "blue"); setLogo(c.display_logo_url ?? null);
    setBanners(Array.isArray(c.display_banners) ? [c.display_banners[0] ?? null, c.display_banners[1] ?? null, c.display_banners[2] ?? null] : [null, null, null]); setEvents((e ?? []) as EventRow[]); setStatus("");
    setReferees(Array.isArray(c.referee_names) && c.referee_names.length ? c.referee_names : Array.from({length:12},(_,i)=>`Arbitre ${i+1}`));
    setRoster({minPlayers:Number(c.min_players_per_team??6),maxPlayers:Number(c.max_players_per_team??7),minStaff:Number(c.min_staff_per_team??1),maxStaff:Number(c.max_staff_per_team??5)});
  })(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, router]);

  async function upload(file: File, kind: "logo" | "banner", index = 0) {
    if (kind === "logo" && file.type !== "image/png") return setStatus("Le logo doit être un fichier PNG.");
    if (kind === "banner" && !["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setStatus("La bannière doit être en PNG, JPG ou WEBP.");
    const ext = file.name.split(".").pop()?.toLowerCase() || "png"; const path = `challenges/${id}/${kind}-${index}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("partners").upload(path, file, { upsert: true }); if (error) return setStatus("Erreur image: " + error.message);
    const url = supabase.storage.from("partners").getPublicUrl(path).data.publicUrl;
    if (kind === "logo") setLogo(url); else setBanners(prev => prev.map((v, i) => i === index ? url : v)); setStatus("Image chargée. Pensez à enregistrer.");
  }
  function addEvent() { setEvents(prev => [...prev, { title: "Nouvel événement", start_time: "09:00", duration_minutes: 15, event_type: "announcement", position: prev.length }]); }
  async function save() {
    if (!title.trim()) return setStatus("Le nom est obligatoire."); if (fields.some(f => !f.trim())) return setStatus("Chaque terrain doit avoir un nom.");
    setSaving(true); setStatus("");
    if (roster.minPlayers < 1 || roster.maxPlayers < roster.minPlayers || roster.minStaff < 1 || roster.maxStaff < roster.minStaff) return setStatus("Vérifiez les limites d’effectif.");
    const { error } = await supabase.from("challenges").update({ title: title.trim(), event_date: date || null, venue: venue.trim() || null, field_names: fields.map(f => f.trim()), match_duration_min: matchDuration, rotation_duration_min: rotation, display_theme: theme, display_logo_url: logo, display_banners: banners, referee_names: referees.map(x=>x.trim()).filter(Boolean), min_players_per_team:roster.minPlayers, max_players_per_team:roster.maxPlayers, min_staff_per_team:roster.minStaff, max_staff_per_team:roster.maxStaff }).eq("id", id);
    if (error) { setSaving(false); return setStatus("Erreur: " + error.message); }
    const { error: del } = await supabase.from("challenge_events").delete().eq("challenge_id", id); if (del) { setSaving(false); return setStatus("Erreur événements: " + del.message); }
    if (events.length) { const { error: ins } = await supabase.from("challenge_events").insert(events.map((e, i) => ({ challenge_id: id, title: e.title.trim(), start_time: e.start_time, duration_minutes: Number(e.duration_minutes), event_type: e.event_type, position: i }))); if (ins) { setSaving(false); return setStatus("Erreur événements: " + ins.message); } }
    setSaving(false); setStatus("Réglages enregistrés ✅");
  }
  return <main className="min-h-screen bg-slate-100 p-6"><div className="max-w-5xl mx-auto space-y-4">
    <header className="bg-slate-950 text-white rounded-2xl p-6 flex justify-between gap-3 flex-wrap"><div><p className="text-sky-400 font-bold text-sm">ORCHESTRATION & ÉCRANS</p><h1 className="text-3xl font-black">Réglages du challenge</h1></div><div className="flex gap-2"><button onClick={() => window.open(`/challenges/${id}/screen`, "_blank")} className="bg-sky-500 px-4 py-2 rounded-xl font-bold">Voir l’écran</button><button onClick={() => router.back()} className="bg-white/10 px-4 py-2 rounded-xl">Retour</button></div></header>
    {status && <div className="bg-white border rounded-xl p-4 text-amber-700">{status}</div>}
    <section className="bg-white rounded-2xl shadow p-6 space-y-5"><h2 className="font-black text-xl">Informations générales</h2><div className="grid md:grid-cols-2 gap-4">
      <label className="font-semibold">Nom<input className="block w-full border rounded-xl p-3 mt-1" value={title} onChange={e => setTitle(e.target.value)} /></label><label className="font-semibold">Date<input type="date" className="block w-full border rounded-xl p-3 mt-1" value={date} onChange={e => setDate(e.target.value)} /></label><label className="font-semibold">Lieu<input className="block w-full border rounded-xl p-3 mt-1" value={venue} onChange={e => setVenue(e.target.value)} /></label><div className="grid grid-cols-2 gap-3"><label className="font-semibold">Match (min)<input type="number" className="block w-full border rounded-xl p-3 mt-1" value={matchDuration} onChange={e => setMatchDuration(Number(e.target.value))} /></label><label className="font-semibold">Rotation (min)<input type="number" className="block w-full border rounded-xl p-3 mt-1" value={rotation} onChange={e => setRotation(Number(e.target.value))} /></label></div>
    </div><div><div className="flex justify-between"><h3 className="font-bold">Terrains partagés ({fields.length})</h3><button onClick={() => setFields(p => [...p, `Terrain ${p.length + 1}`])} className="text-sky-700 font-bold">+ Terrain</button></div><div className="grid md:grid-cols-2 gap-3 mt-2">{fields.map((f,i)=><div key={i} className="flex gap-2"><input className="border rounded-xl p-3 flex-1" value={f} onChange={e => setFields(p => p.map((x,j)=>j===i?e.target.value:x))}/><button onClick={()=>setFields(p=>p.filter((_,j)=>j!==i))} className="text-red-600 px-2">×</button></div>)}</div></div></section>
    <section className="bg-white rounded-2xl shadow p-6 space-y-4"><div><h2 className="font-black text-xl">Préréglage des fiches d’équipe</h2><p className="text-sm text-gray-500">Ces limites s’appliquent aux fiches publiques de tous les tournois du challenge.</p></div><div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{([['minPlayers','Joueurs minimum'],['maxPlayers','Joueurs maximum'],['minStaff','Encadrants minimum'],['maxStaff','Encadrants maximum']] as const).map(([key,label])=><label key={key} className="font-semibold text-sm">{label}<input type="number" min="1" className="block w-full border rounded-xl p-3 mt-1" value={roster[key]} onChange={e=>setRoster(p=>({...p,[key]:Number(e.target.value)}))}/></label>)}</div></section>
    <section className="bg-white rounded-2xl shadow p-6 space-y-4"><div className="flex justify-between gap-3"><div><h2 className="font-black text-xl">Arbitres du challenge</h2><p className="text-sm text-gray-500">Cette liste est commune à tous les tournois. Un arbitre ne peut être affecté qu’à un seul terrain sur un même créneau.</p></div><button onClick={()=>setReferees(p=>[...p,`Arbitre ${p.length+1}`])} className="text-sky-700 font-bold h-fit">+ Arbitre</button></div><div className="grid md:grid-cols-3 gap-3">{referees.map((name,i)=><div key={i} className="flex gap-2"><input className="border rounded-xl p-3 min-w-0 flex-1" value={name} onChange={e=>setReferees(p=>p.map((x,j)=>j===i?e.target.value:x))}/><button onClick={()=>setReferees(p=>p.filter((_,j)=>j!==i))} className="text-red-600">×</button></div>)}</div></section>
    <section className="bg-white rounded-2xl shadow p-6 space-y-4"><h2 className="font-black text-xl">Couleurs de l’affichage</h2><div className="flex flex-wrap gap-2">{THEMES.map(v=><button key={v} onClick={()=>setTheme(v)} className={`px-4 py-3 rounded-xl border font-bold ${theme===v?"ring-2 ring-slate-950":""}`} style={{backgroundColor: ({blue:"#0b2f47",red:"#651b24",orange:"#9a4312",green:"#195b45",yellow:"#d9aa18",purple:"#51266d",sky:"#2f7fa0"} as Record<string,string>)[v],color:v==="yellow"?"#111":"white"}}>{THEME_LABELS[v]}</button>)}</div>
      <div>
        <h3 className="font-bold">Logo et bannières</h3>
        <p className="text-sm text-gray-500 mt-1">Formats adaptés à la hauteur compacte utilisée en affichage normal et plein écran. Placez les textes et logos importants dans les 80 % centraux : les côtés peuvent être légèrement recadrés sur mobile.</p>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
        <ImageCard label="Logo carré" spec="800 × 800 px · PNG uniquement · fond transparent conseillé" shape="square" value={logo} onFile={f=>upload(f,"logo")} clear={()=>setLogo(null)} accept="image/png"/>
        <ImageCard label="Bannière latérale gauche" spec="1200 × 125 px · ratio 9,6:1 · PNG, JPG ou WEBP" shape="banner" value={banners[0]} onFile={f=>upload(f,"banner",0)} clear={()=>setBanners(p=>p.map((v,j)=>j===0?null:v))} accept="image/png,image/jpeg,image/webp"/>
        <ImageCard label="Bannière centrale" spec="1800 × 125 px · ratio 14,4:1 · PNG, JPG ou WEBP" shape="banner" value={banners[1]} onFile={f=>upload(f,"banner",1)} clear={()=>setBanners(p=>p.map((v,j)=>j===1?null:v))} accept="image/png,image/jpeg,image/webp"/>
        <ImageCard label="Bannière latérale droite" spec="1200 × 125 px · ratio 9,6:1 · PNG, JPG ou WEBP" shape="banner" value={banners[2]} onFile={f=>upload(f,"banner",2)} clear={()=>setBanners(p=>p.map((v,j)=>j===2?null:v))} accept="image/png,image/jpeg,image/webp"/>
      </div>
    </section>
    <section className="bg-white rounded-2xl shadow p-6 space-y-3"><div className="flex justify-between"><div><h2 className="font-black text-xl">Événements du challenge</h2><p className="text-sm text-gray-500">Accueil, briefing, cérémonie, pause et clôture rejoignent automatiquement le déroulé public.</p></div><button onClick={addEvent} className="bg-slate-950 text-white px-4 py-2 rounded-xl h-fit">+ Événement</button></div>{events.map((e,i)=><div key={i} className="grid md:grid-cols-[1fr_130px_120px_160px_44px] gap-2 border rounded-xl p-3"><input className="border rounded-lg p-2" value={e.title} onChange={x=>setEvents(p=>p.map((v,j)=>j===i?{...v,title:x.target.value}:v))}/><input type="time" className="border rounded-lg p-2" value={e.start_time.slice(0,5)} onChange={x=>setEvents(p=>p.map((v,j)=>j===i?{...v,start_time:x.target.value}:v))}/><input type="number" className="border rounded-lg p-2" value={e.duration_minutes} onChange={x=>setEvents(p=>p.map((v,j)=>j===i?{...v,duration_minutes:Number(x.target.value)}:v))}/><select className="border rounded-lg p-2" value={e.event_type} onChange={x=>setEvents(p=>p.map((v,j)=>j===i?{...v,event_type:x.target.value}:v))}><option value="welcome">Accueil</option><option value="briefing">Briefing</option><option value="ceremony">Cérémonie</option><option value="break">Pause</option><option value="announcement">Annonce</option><option value="closing">Clôture</option></select><button onClick={()=>setEvents(p=>p.filter((_,j)=>j!==i))} className="text-red-600 text-xl">×</button></div>)}</section>
    <div className="flex justify-end"><button disabled={saving} onClick={save} className="bg-amber-400 px-6 py-3 rounded-xl font-black disabled:opacity-50">{saving?"Enregistrement...":"Enregistrer tous les réglages"}</button></div>
  </div></main>;
}

function ImageCard({label,spec,shape,value,onFile,clear,accept}:{label:string;spec:string;shape:"square"|"banner";value:string|null;onFile:(f:File)=>void;clear:()=>void;accept:string}) { return <div className="border rounded-xl p-3 flex flex-col"><strong className="text-sm">{label}</strong><span className="text-xs text-sky-700 font-semibold mt-1 min-h-8">{spec}</span><div className={`${shape==="square"?"h-28 w-28 self-center":"h-24 w-full"} bg-slate-100 rounded-lg my-3 flex items-center justify-center overflow-hidden`}>{value?<img src={value} alt={`Aperçu ${label.toLowerCase()}`} className="w-full h-full object-contain"/>:<span className="text-gray-400 text-xs">Aucune image</span>}</div><div className="flex gap-2 mt-auto"><label className="cursor-pointer bg-slate-950 text-white px-3 py-2 rounded-lg text-xs">Choisir<input type="file" accept={accept} className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)onFile(f)}}/></label>{value&&<button onClick={clear} className="text-red-600 text-xs">Retirer</button>}</div></div> }
