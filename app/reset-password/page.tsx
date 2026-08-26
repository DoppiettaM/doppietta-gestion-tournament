"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState("Vérification du lien sécurisé…");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;

    const verifyRecoverySession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;

      if (data.session) {
        setReady(true);
        setStatus("");
      } else {
        setStatus("❌ Ce lien est invalide ou a expiré. Demande un nouveau lien depuis la page d’accueil.");
      }
    };

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY" || session) {
        setReady(true);
        setStatus("");
      }
    });

    void verifyRecoverySession();

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");

    if (password.length < 8) {
      return setStatus("⚠️ Choisis un mot de passe d’au moins 8 caractères.");
    }
    if (password !== confirmation) {
      return setStatus("⚠️ Les deux mots de passe ne correspondent pas.");
    }

    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);

    if (error) return setStatus("❌ Modification impossible : " + error.message);

    setStatus("✅ Mot de passe modifié. Retour à la connexion…");
    await supabase.auth.signOut();
    window.setTimeout(() => router.replace("/"), 1200);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 px-6 py-12 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl">
        <div className="text-sm font-semibold text-blue-200">Doppietta Gestion Tournament</div>
        <h1 className="mt-2 text-3xl font-extrabold">Choisir un nouveau mot de passe</h1>
        <p className="mt-3 text-sm text-white/70">
          Utilise un mot de passe unique, suffisamment long et différent de tes autres comptes.
        </p>

        {ready && (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-xs font-semibold text-white/70">Nouveau mot de passe</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 outline-none focus:border-blue-300"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-white/70">Confirmer le mot de passe</span>
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 outline-none focus:border-blue-300"
              />
            </label>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-extrabold text-slate-900 transition hover:bg-slate-100 disabled:opacity-60"
            >
              {busy ? "Modification…" : "Enregistrer mon nouveau mot de passe"}
            </button>
          </form>
        )}

        {status && (
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/90">
            {status}
          </div>
        )}

        <Link href="/" className="mt-5 block text-center text-sm font-semibold text-blue-200 hover:text-white">
          ← Retour à l’accueil
        </Link>
      </section>
    </main>
  );
}
