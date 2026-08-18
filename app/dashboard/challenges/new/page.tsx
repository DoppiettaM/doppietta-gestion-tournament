"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {supabase} from "@/lib/supabaseClient";

export default function NewChallenge(){
  const r=useRouter(); const[name,setName]=useState('Challenge Michel Clipet'); const[date,setDate]=useState(''); const[template,setTemplate]=useState('michel_clipet'); const[s,setS]=useState('');
  async function create(){
    const{data:u}=await supabase.auth.getUser(); if(!u.user)return r.push('/login');
    const config=template==='michel_clipet'?{categories:['U8','U9'],teamsPerTournament:10,matchDuration:10,rotationDuration:3,scoring:{win:8,draw:4,loss:2,goalBonus:1},ranking:['points','goals_for','goals_against','draw'],phase1:'single_round_robin',phase2:{top4:'semifinals_finals',places5_7:'round_robin',places8_10:'round_robin'},challengePoints:[20,19,18,17,16,15,14,13,12,11]}:{};
    const{data:c,error}=await supabase.from('challenges').insert({user_id:u.user.id,name:name.trim(),title:name.trim(),event_date:date||null,challenge_date:date||null,template,config}).select('id').single(); if(error||!c)return setS(error?.message||'Création impossible');
    if(template==='michel_clipet'){
      const rows=['U8','U9'].map(category=>({user_id:u.user!.id,title:`${name.trim()} — ${category}`,tournament_date:date||null,match_duration_min:10,rotation_duration_min:3,min_teams:10,max_teams:10,min_players_per_team:5,max_players_per_team:9,format:'round_robin',group_count:1,challenge_id:c.id,category,competition_config:{template:'michel_clipet',scoring:config.scoring,ranking:config.ranking},phase_state:{phase1:'not_started',phase2:'locked'}}));
      const{error:te}=await supabase.from('tournaments').insert(rows); if(te)return setS(`Challenge créé, mais création U8/U9 impossible : ${te.message}`);
    }
    r.push(`/dashboard/challenges/${c.id}`);
  }
  return <main className="min-h-screen bg-slate-100 p-6"><div className="max-w-3xl mx-auto bg-white rounded-2xl shadow p-6"><h1 className="text-2xl font-black">Créer un challenge</h1><p className="text-sm text-slate-500 mt-1">Un challenge peut regrouper plusieurs tournois et définir son propre classement général.</p><div className="grid gap-4 mt-6"><label>Nom<input className="block w-full border rounded-xl p-3 mt-1" value={name} onChange={e=>setName(e.target.value)}/></label><label>Date<input type="date" className="block w-full border rounded-xl p-3 mt-1" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Architecture<select className="block w-full border rounded-xl p-3 mt-1" value={template} onChange={e=>setTemplate(e.target.value)}><option value="michel_clipet">Challenge Michel Clipet — U8 + U9</option><option value="custom">Challenge personnalisé</option></select></label>{template==='michel_clipet'&&<div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm"><b>Préconfiguration Michel Clipet</b><br/>Création automatique des tournois U8 🔴 et U9 ⚫ · 10 équipes chacun · 10 min + rotation 3 min · M1–M55 · barème 8/4/2 + 1 point/but · classement général 20 à 11 points.</div>}<button onClick={create} className="bg-blue-600 text-white rounded-xl p-3 font-bold">Créer le challenge et ses tournois</button>{s&&<p className="text-sm text-red-600">{s}</p>}</div></div></main>
}
