"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Challenge = { id:string; title:string; challenge_date:string|null; created_at:string };
export default function ChallengesPage(){
 const router=useRouter(); const [rows,setRows]=useState<Challenge[]>([]); const [status,setStatus]=useState("Chargement…");
 useEffect(()=>{(async()=>{const {data:a}=await supabase.auth.getUser(); if(!a.user)return router.push('/login'); const {data,error}=await supabase.from('challenges').select('id,title,challenge_date,created_at').order('created_at',{ascending:false}); if(error)setStatus(error.message); else {setRows((data??[]) as Challenge[]);setStatus('');}})()},[router]);
 return <main className="min-h-screen bg-slate-100 p-6"><div className="max-w-5xl mx-auto space-y-4">
  <div className="bg-white rounded-2xl shadow p-6 flex justify-between gap-4 flex-wrap"><div><h1 className="text-2xl font-extrabold">Challenges</h1><p className="text-sm text-gray-500">Gestion multi-tournois U8/U9 et classement général.</p></div><div className="flex gap-2"><button className="bg-gray-200 px-4 py-2 rounded-xl" onClick={()=>router.push('/dashboard/tournaments')}>Tournois classiques</button><button className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold" onClick={()=>router.push('/dashboard/challenges/create')}>+ Challenge Michel Clipet</button></div></div>
  {status&&<div className="bg-white rounded-xl shadow p-4">{status}</div>}
  {rows.map(c=><button key={c.id} onClick={()=>router.push(`/dashboard/challenges/${c.id}`)} className="w-full text-left bg-white rounded-2xl shadow p-5 hover:ring-2 hover:ring-blue-200"><div className="font-extrabold text-lg">{c.title}</div><div className="text-sm text-gray-500">{c.challenge_date?new Date(c.challenge_date+'T12:00:00').toLocaleDateString('fr-FR'):'Date non définie'} · U8 🔴 + U9 ⚫️</div></button>)}
 </div></main>
}
