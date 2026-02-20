"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

export default function SupabaseTestPage() {
  const [status, setStatus] = useState<string>("Test en cours...");

  useEffect(() => {
    async function run() {
      const { data, error } = await supabase.auth.getSession();
      if (error) setStatus("Erreur: " + error.message);
      else setStatus("OK ✅ Supabase connecté. Session: " + (data.session ? "connectée" : "aucune"));
    }
    run();
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Test Supabase</h1>
      <p>{status}</p>
    </main>
  );
}