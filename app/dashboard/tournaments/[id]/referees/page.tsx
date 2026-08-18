"use client";
import {useEffect,useMemo,useState} from "react";
import {useParams,useRouter} from "next/navigation";
import {supabase} from "@/lib/supabaseClient";
import {assignReferees} from "@/lib/refereeEngine";

type Ref={id:string;name:string;active:boolean};
type M={id:string;start_time:string;field_idx:number;home_team_id:string;away_team_id:string;match_number:number|null;home:{name:string}|null;away:{name:string}|null};
type A={match_id:string;referee_id:string};

export default function Referees(){
  const p=useParams();const r=useRouter();const tid=String(p.id);const[refs,setRefs]=useState<Ref[]>([]);const[matches,setMatches]=useState<M[]>([]);const[assign,setAssign]=useState<Record<string,string>>({});const[name,setName]=useState('');const[s,setS]=useState('');
  async function load(){const[a,b,c]=await Promise.all([supabase.from('referees').select('id,name,active').eq('tournament_id',tid).order('name'),supabase.from('matches').select('id,start_time,field_idx,match_number,home_team_id,away_team_id,home:home_team_id(name),away:away_team_id(name)').eq('tournament_id',tid).order('start_time').order('field_idx'),supabase.from('referee_assignments').select('match_id,referee_id').eq('tournament_id',tid)]);if(a.error||c.error){setS('Installez la migration Challenge/Arbitres dans Supabase.');return}setRefs((a.data??[]) as Ref[]);setMatches((b.data??[]) as any);setAssign(Object.fromEntries(((c.data??[]) as A[]).map(x=>[x.match_id,x.referee_id])));setS('')}
  useEffect(()=>{(async()=>{const{data}=await supabase.auth.getUser();if(!data.user)return r.push('/login');load()})()},[tid]);
  const active=useMemo(()=>refs.filter(x=>x.active),[refs]);
  async function add(){if(!name.trim())return;const{error}=await supabase.from('referees').insert({tournament_id:tid,name:name.trim()});if(error)return setS(error.message);setName('');load()}
  async function save(mid:string,rid:string){setAssign(x=>({...x,[mid]:rid}));if(!rid){await supabase.from('referee_assignments').delete().eq('match_id',mid);return}await supabase.from('referee_assignments').upsert({tournament_id:tid,match_id:mid,referee_id:rid},{onConflict:'match_id'});}
  async function generate(){
    if(!active.length)return setS('Ajoutez au moins un arbitre.');
    const result=assignReferees(
      active.map(x=>({id:x.id,name:x.name})),
      matches.map(m=>({id:m.id,startTime:m.start_time,fieldIdx:m.field_idx,homeTeamId:m.home_team_id,awayTeamId:m.away_team_id}))
    );
    await supabase.from('referee_assignments').delete().eq('tournament_id',tid);
    const rows=Object.entries(result.assignments).map(([match_id,referee_id])=>({tournament_id:tid,match_id,referee_id}));
    if(rows.length){
      const{error}=await supabase.from('referee_assignments').insert(rows);
      if(error)return setS(error.message)
    }
    setAssign(result.assignments);
    const notes=[
      `${rows.length}/${matches.length} matchs affectés`,
      result.unassignedMatchIds.length?`${result.unassignedMatchIds.length} sans arbitre (indisponibilité simultanée)`:null,
      result.repeatedTeamRelaxations?`${result.repeatedTeamRelaxations} répétition(s) d'équipe inévitable(s)`:null,
      result.consecutiveSlotRelaxations?`${result.consecutiveSlotRelaxations} repos consécutif(s) impossible(s)`:null,
    ].filter(Boolean).join(' · ');
    setS(`Affectation générée : ${notes}. Toutes les affectations restent modifiables manuellement.`)
  }
  return <main className="min-h-screen bg-slate-100 p-6"><div className="max-w-6xl mx-auto space-y-4"><div className="bg-white rounded-2xl shadow p-6 flex justify-between"><div><h1 className="text-2xl font-black">Arbitres</h1><p className="text-sm text-slate-500">Génération automatique : pas de double affectation simultanée, repos d'un créneau si possible, évitement de la même équipe consécutive et répartition équilibrée.</p></div><button onClick={()=>r.push(`/dashboard/tournaments/${tid}`)} className="bg-slate-200 px-4 py-2 rounded-xl">Retour</button></div><div className="bg-white rounded-2xl shadow p-5"><div className="flex gap-2 flex-wrap"><input value={name} onChange={e=>setName(e.target.value)} placeholder="Nom de l'arbitre" className="border rounded-xl p-3 flex-1 min-w-[220px]"/><button onClick={add} className="bg-slate-900 text-white px-5 rounded-xl font-bold">Ajouter</button><button onClick={generate} className="bg-blue-600 text-white px-5 rounded-xl font-bold">Générer les affectations</button></div>{s&&<p className="text-sm mt-3 text-slate-600">{s}</p>}</div><div className="bg-white rounded-2xl shadow overflow-hidden"><div className="divide-y">{matches.map((m,i)=><div key={m.id} className="p-4 grid md:grid-cols-[130px_1fr_260px] gap-3 items-center"><div className="font-bold">{m.match_number?`M${m.match_number}`:`Match ${i+1}`} · {String(m.start_time).slice(0,5)}</div><div>{m.home?.name??'Équipe'} — {m.away?.name??'Équipe'} <span className="text-slate-400">· Terrain {m.field_idx}</span></div><select className="border rounded-xl p-2" value={assign[m.id]??''} onChange={e=>save(m.id,e.target.value)}><option value="">Sans arbitre</option>{active.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></div>)}</div></div></div></main>
}
