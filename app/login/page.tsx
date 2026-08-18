"use client";

import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");

  async function signUp() {
    setStatus("Création du compte...");
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) setStatus("Erreur: " + error.message);
    else setStatus("Compte créé ✅ (vérifie tes emails si confirmation activée).");
  }

  async function signIn() {
    setStatus("Connexion...");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setStatus("Erreur: " + error.message);
    else window.location.href = "/dashboard/tournaments";
  }

  async function forgotPassword() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setStatus("Renseigne ton adresse email avant de demander la réinitialisation.");
      return;
    }

    setStatus("Envoi du lien de réinitialisation...");
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) setStatus("Erreur: " + error.message);
    else setStatus("Lien envoyé ✅ Consulte tes emails puis ouvre le lien de réinitialisation.");
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="bg-white shadow-lg rounded-xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6 text-center">
          Doppietta Gestion Tournament
        </h1>

        <input
          className="w-full border rounded-lg p-3 mb-4"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Email"
        />

        <input
          className="w-full border rounded-lg p-3 mb-6"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder="Mot de passe"
        />

        <div className="flex flex-col gap-3">
          <button
            onClick={signIn}
            className="bg-blue-600 text-white p-3 rounded-lg hover:bg-blue-700 transition"
          >
            Se connecter
          </button>

          <button
            onClick={signUp}
            className="bg-gray-200 p-3 rounded-lg hover:bg-gray-300 transition"
          >
            Créer un compte
          </button>

          <button
            onClick={forgotPassword}
            className="text-sm text-blue-700 underline underline-offset-4 py-2"
          >
            Mot de passe oublié ?
          </button>
        </div>

        <p className="text-sm text-center mt-4 text-gray-500">{status}</p>
      </div>
    </main>
  );
}