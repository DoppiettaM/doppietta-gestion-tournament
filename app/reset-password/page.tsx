"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState("Vérification du lien de réinitialisation...");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function prepareRecoverySession() {
      try {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code");

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error && !error.message.toLowerCase().includes("code verifier")) {
            throw error;
          }
        }

        const { data } = await supabase.auth.getSession();
        if (!mounted) return;

        if (data.session) {
          setReady(true);
          setStatus("Choisis maintenant ton nouveau mot de passe.");
        } else {
          setStatus("Lien invalide ou expiré. Demande un nouveau lien depuis la page de connexion.");
        }
      } catch (error) {
        if (!mounted) return;
        setStatus(error instanceof Error ? error.message : "Lien de réinitialisation invalide.");
      }
    }

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY" || session) {
        setReady(true);
        setStatus("Choisis maintenant ton nouveau mot de passe.");
      }
    });

    prepareRecoverySession();

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function updatePassword() {
    if (password.length < 8) {
      setStatus("Le nouveau mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== confirmPassword) {
      setStatus("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setBusy(true);
    setStatus("Mise à jour du mot de passe...");
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);

    if (error) {
      setStatus("Erreur: " + error.message);
      return;
    }

    setStatus("Mot de passe modifié ✅ Redirection...");
    setTimeout(() => router.push("/dashboard/tournaments"), 900);
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="bg-white shadow-xl rounded-2xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-extrabold mb-2 text-center">Nouveau mot de passe</h1>
        <p className="text-sm text-slate-500 text-center mb-6">Doppietta Gestion Tournament</p>

        <input
          className="w-full border rounded-xl p-3 mb-4 disabled:bg-slate-100"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          autoComplete="new-password"
          placeholder="Nouveau mot de passe"
          disabled={!ready || busy}
        />

        <input
          className="w-full border rounded-xl p-3 mb-5 disabled:bg-slate-100"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          type="password"
          autoComplete="new-password"
          placeholder="Confirmer le mot de passe"
          disabled={!ready || busy}
        />

        <button
          onClick={updatePassword}
          disabled={!ready || busy}
          className="w-full bg-blue-600 text-white font-bold p-3 rounded-xl hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Mise à jour..." : "Mettre à jour le mot de passe"}
        </button>

        <button
          onClick={() => router.push("/login")}
          className="w-full mt-3 text-sm text-slate-600 underline underline-offset-4 py-2"
        >
          Retour à la connexion
        </button>

        <p className="text-sm text-center mt-5 text-slate-600">{status}</p>
      </div>
    </main>
  );
}
