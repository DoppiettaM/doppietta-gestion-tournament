// app/dashboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Plan = "trial" | "starter" | "premium";

function clean(s: string) {
  return (s ?? "").trim();
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Logo SVG "inspiré" des codes couleurs et du mouvement du logo Doppietta,
 * mais texte: "Doppietta Gestion Tournament".
 * (Sans dépendre d'une image externe -> stable en prod)
 */
function BrandMark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="relative w-10 h-10 sm:w-12 sm:h-12">
        <svg viewBox="0 0 120 120" className="w-full h-full">
          <defs>
            <linearGradient id="dg1" x1="0" x2="1">
              <stop offset="0" stopColor="#2563EB" />
              <stop offset="1" stopColor="#1D4ED8" />
            </linearGradient>
            <linearGradient id="dg2" x1="0" x2="1">
              <stop offset="0" stopColor="#EF4444" />
              <stop offset="1" stopColor="#B91C1C" />
            </linearGradient>
          </defs>

          {/* Rubans */}
          <path
            d="M18 78c18-42 54-58 84-56-26 10-45 28-58 54-8 16-16 28-26 32 0 0-8-10 0-30z"
            fill="url(#dg1)"
            opacity="0.95"
          />
          <path
            d="M22 88c22-22 52-28 86-18-28 2-52 14-68 34-10 12-18 16-26 14 0 0-6-8 8-30z"
            fill="url(#dg2)"
            opacity="0.95"
          />
          <path
            d="M34 20c26 10 44 30 52 58 6 18 14 30 26 34-18 2-32-4-42-18-18-26-34-48-64-74 6-2 16-2 28 0z"
            fill="url(#dg1)"
            opacity="0.55"
          />

          {/* Liseré blanc */}
          <path
            d="M24 82c18-38 52-52 78-52-24 10-42 28-54 52-6 12-12 22-18 26 0 0-6-8 -6-26z"
            fill="#FFFFFF"
            opacity="0.85"
          />
        </svg>
      </div>

      <div className="leading-tight">
        <div className="text-sm sm:text-base font-extrabold tracking-tight text-slate-900">
          Doppietta
        </div>
        <div className="text-xs sm:text-sm font-semibold text-slate-600">
          Gestion Tournament
        </div>
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold text-white">
      {children}
    </span>
  );
}

function PriceCard({
  title,
  price,
  subtitle,
  features,
  highlight,
  cta,
  onClick,
}: {
  title: string;
  price: string;
  subtitle: string;
  features: string[];
  highlight?: boolean;
  cta: string;
  onClick: () => void;
}) {
  return (
    <div
      className={[
        "rounded-3xl border p-6 shadow-sm",
        highlight
          ? "border-blue-200 bg-white"
          : "border-white/10 bg-white/5 text-white",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={highlight ? "text-slate-900" : "text-white"} >
            <div className="text-sm font-semibold opacity-90">{title}</div>
            <div className="mt-1 text-3xl font-extrabold">{price}</div>
            <div className="mt-1 text-sm opacity-80">{subtitle}</div>
          </div>
        </div>
        {highlight && (
          <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-extrabold text-white">
            Recommandé
          </span>
        )}
      </div>

      <ul className={["mt-5 space-y-2 text-sm", highlight ? "text-slate-700" : "text-white/85"].join(" ")}>
        {features.map((f) => (
          <li key={f} className="flex gap-2">
            <span className={highlight ? "text-blue-600" : "text-white"}>✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      <button
        onClick={onClick}
        className={[
          "mt-6 w-full rounded-2xl px-4 py-3 text-sm font-extrabold transition",
          highlight
            ? "bg-slate-900 text-white hover:bg-black"
            : "bg-white text-slate-900 hover:bg-slate-100",
        ].join(" ")}
      >
        {cta}
      </button>
    </div>
  );
}

export default function DashboardLandingPage() {
  const router = useRouter();

  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  // Auth forms
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Upgrade request
  const [wantPlan, setWantPlan] = useState<Plan>("starter");
  const [note, setNote] = useState("");

  const heroBg = useMemo(() => {
    // Palette inspirée logo: bleu/rouge, fond sombre
    return "bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950";
  }, []);

  useEffect(() => {
    // si déjà connecté, on va direct sur le cœur de l'app
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user) router.push("/dashboard/tournaments");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogin() {
    setStatus("");
    const e = clean(email);
    const p = password;

    if (!isValidEmail(e)) return setStatus("⚠️ Email invalide.");
    if (p.length < 6) return setStatus("⚠️ Mot de passe trop court (min 6).");

    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: e, password: p });
    setBusy(false);

    if (error) return setStatus("❌ Connexion impossible: " + error.message);

    setStatus("✅ Connecté. Redirection…");
    router.push("/dashboard/tournaments");
  }

  async function handleSignupTrial() {
    setStatus("");
    const e = clean(email);
    const p = password;

    if (!isValidEmail(e)) return setStatus("⚠️ Email invalide.");
    if (p.length < 6) return setStatus("⚠️ Mot de passe trop court (min 6).");

    setBusy(true);

    const { data, error } = await supabase.auth.signUp({
      email: e,
      password: p,
      options: {
        // selon ta config supabase, tu peux mettre un redirect vers une page "confirm"
        // emailRedirectTo: `${location.origin}/dashboard`
      },
    });

    if (error) {
      setBusy(false);
      return setStatus("❌ Création impossible: " + error.message);
    }

    // Optionnel: enregistrer une "demande d'accès" en DB (si table dispo)
    // Table suggérée: account_requests(id uuid, email text, plan text, note text, status text, created_at timestamp)
    try {
      await supabase.from("account_requests").insert({
        email: e,
        plan: "trial",
        note: "Essai (auto)",
        status: "pending",
      } as any);
    } catch {
      // si la table n'existe pas, on ne casse rien
    }

    setBusy(false);

    // Selon config email confirm, l'utilisateur peut devoir confirmer.
    const confirmed = Boolean(data?.user && !data.user?.identities?.length);
    // (Supabase renvoie parfois user + session null tant que pas confirmé)

    setStatus(
      confirmed
        ? "✅ Compte créé. Vérifie tes emails pour confirmer, puis reconnecte-toi."
        : "✅ Compte créé. Redirection…"
    );

    // Si session dispo, on peut aller direct
    const { data: u2 } = await supabase.auth.getUser();
    if (u2?.user) router.push("/dashboard/tournaments");
  }

  async function handleRequestPlan(plan: Plan) {
    setStatus("");
    const e = clean(email);

    // Si pas connecté: on prend l'email du champ
    // Si connecté: on prend l'email du user
    const { data } = await supabase.auth.getUser();
    const emailToUse = data?.user?.email ?? e;

    if (!emailToUse || !isValidEmail(emailToUse)) {
      return setStatus("⚠️ Renseigne un email valide (ou connecte-toi).");
    }

    setBusy(true);

    // Demande d'upgrade à valider par toi
    try {
      const { error } = await supabase.from("account_requests").insert({
        email: emailToUse,
        plan,
        note: clean(note) || null,
        status: "pending",
      } as any);

      if (error) {
        // si la table n’existe pas -> message clair
        setBusy(false);
        return setStatus(
          "⚠️ Impossible d’envoyer la demande (table account_requests absente ou droits). " +
            "Dis-moi si tu veux que je te crée le SQL Supabase."
        );
      }
    } catch {
      setBusy(false);
      return setStatus(
        "⚠️ Impossible d’envoyer la demande. Dis-moi si tu veux que je te crée le SQL Supabase."
      );
    }

    setBusy(false);
    setStatus("✅ Demande envoyée. Tu pourras la valider côté admin.");
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/* HERO */}
      <section className={`${heroBg}`}>
        <div className="mx-auto max-w-7xl px-6 py-10 sm:py-14">
          <div className="flex items-center justify-between gap-4">
            <BrandMark />
            <div className="hidden sm:flex items-center gap-2">
              <Pill>⚽ Tournois</Pill>
              <Pill>📺 Écran</Pill>
              <Pill>📊 Classements</Pill>
            </div>
          </div>

          <div className="mt-10 grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            {/* Left */}
            <div>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight">
                La régie de tournoi qui tient dans ta poche 📱
              </h1>
              <p className="mt-4 text-white/80 text-base sm:text-lg">
                Planifie, gère les matchs, affiche l’écran géant, calcule les classements et
                centralise les résultats. Pensé pour la réalité terrain.
              </p>

              <div className="mt-6 flex flex-wrap gap-2">
                <Pill>🔁 Mise à jour auto</Pill>
                <Pill>🏟️ Terrains personnalisés</Pill>
                <Pill>🧩 Poules & noms</Pill>
                <Pill>🧾 Feuilles PDF</Pill>
              </div>

              {/* Galerie mini */}
              <div className="mt-8 grid grid-cols-3 gap-3">
                {[
                  "/gallery/event-1.jpg",
                  "/gallery/event-2.jpg",
                  "/gallery/event-3.jpg",
                ].map((src) => (
                  <div
                    key={src}
                    className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-white/10 bg-white/5"
                    title="Ajoute tes photos dans public/gallery/"
                  >
                    <Image
                      src={src}
                      alt="Événement Doppietta"
                      fill
                      className="object-cover opacity-90"
                      sizes="(max-width: 1024px) 33vw, 240px"
                      onError={(e) => {
                        // fallback visuel si l'image n'existe pas
                        const el = e.currentTarget as any;
                        el.style.display = "none";
                      }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-white/50">
                      (photo à ajouter)
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-white/50">
                Astuce: mets 3 photos dans <span className="font-mono">public/gallery/</span> :
                <span className="font-mono"> event-1.jpg</span>,{" "}
                <span className="font-mono">event-2.jpg</span>,{" "}
                <span className="font-mono">event-3.jpg</span>.
              </p>
            </div>

            {/* Right: Auth Card */}
            <div className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white/80">
                    Accès à ton espace
                  </div>
                  <div className="text-2xl font-extrabold">
                    {mode === "login" ? "Connexion" : "Créer un compte Essai"}
                  </div>
                </div>
                <button
                  onClick={() => setMode((m) => (m === "login" ? "signup" : "login"))}
                  className="rounded-2xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/15 transition"
                >
                  {mode === "login" ? "Essai" : "J’ai déjà un compte"}
                </button>
              </div>

              <div className="mt-5 space-y-3">
                <label className="block">
                  <div className="text-xs font-semibold text-white/70">Email</div>
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm outline-none focus:border-white/25"
                    placeholder="ex: contact@doppietta.fr"
                    inputMode="email"
                    autoComplete="email"
                  />
                </label>

                <label className="block">
                  <div className="text-xs font-semibold text-white/70">Mot de passe</div>
                  <input
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm outline-none focus:border-white/25"
                    placeholder="min 6 caractères"
                    type="password"
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                  />
                </label>

                {status && (
                  <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white/90">
                    {status}
                  </div>
                )}

                {mode === "login" ? (
                  <button
                    onClick={handleLogin}
                    disabled={busy}
                    className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-extrabold text-slate-900 hover:bg-slate-100 transition disabled:opacity-60"
                  >
                    {busy ? "..." : "Se connecter →"}
                  </button>
                ) : (
                  <button
                    onClick={handleSignupTrial}
                    disabled={busy}
                    className="w-full rounded-2xl bg-white px-4 py-3 text-sm font-extrabold text-slate-900 hover:bg-slate-100 transition disabled:opacity-60"
                  >
                    {busy ? "..." : "Créer mon compte Essai →"}
                  </button>
                )}

                <div className="mt-3 text-xs text-white/55">
                  Si tu as activé la confirmation email sur Supabase, pense à valider l’email avant la première connexion.
                </div>
              </div>

              {/* Upgrade request */}
              <div className="mt-6 rounded-3xl border border-white/10 bg-black/20 p-5">
                <div className="text-sm font-extrabold">Passer à Starter / Premium</div>
                <div className="mt-1 text-xs text-white/60">
                  La demande sera “en attente”, puis validée par toi (admin).
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setWantPlan("starter")}
                    className={[
                      "rounded-2xl px-3 py-2 text-xs font-extrabold border transition",
                      wantPlan === "starter"
                        ? "border-blue-400 bg-blue-600 text-white"
                        : "border-white/10 bg-white/5 text-white/85 hover:bg-white/10",
                    ].join(" ")}
                  >
                    Starter
                  </button>
                  <button
                    onClick={() => setWantPlan("premium")}
                    className={[
                      "rounded-2xl px-3 py-2 text-xs font-extrabold border transition",
                      wantPlan === "premium"
                        ? "border-red-300 bg-red-600 text-white"
                        : "border-white/10 bg-white/5 text-white/85 hover:bg-white/10",
                    ].join(" ")}
                  >
                    Premium
                  </button>
                </div>

                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="mt-3 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-sm outline-none focus:border-white/25"
                  placeholder="Note (optionnel): taille événement, besoin écran géant, etc."
                  rows={3}
                />

                <button
                  onClick={() => handleRequestPlan(wantPlan)}
                  disabled={busy}
                  className="mt-3 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-extrabold text-white hover:bg-black transition disabled:opacity-60"
                >
                  {busy ? "..." : "Envoyer la demande"}
                </button>

                <div className="mt-2 text-[11px] text-white/55">
                  (Option DB) Table <span className="font-mono">account_requests</span> recommandée. Si elle n’existe pas, je te donne le SQL.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST / SUPPORTERS */}
      <section className="bg-slate-950">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-2xl font-extrabold">Ils nous soutiennent</h2>
              <p className="mt-1 text-sm text-white/70">
                Ajoute ici les logos des clubs, collectivités, partenaires, sponsors.
              </p>
            </div>
            <div className="text-xs text-white/50">
              Placeholders prêts, remplace ensuite.
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm font-extrabold text-white/60"
              >
                Logo #{i + 1}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="bg-gradient-to-b from-slate-950 to-slate-900">
        <div className="mx-auto max-w-7xl px-6 py-12">
          <h2 className="text-2xl font-extrabold">Tarifs</h2>
          <p className="mt-1 text-sm text-white/70">
            Commence en Essai, puis demande le déblocage Starter ou Premium.
          </p>

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <PriceCard
              title="Essai"
              price="0€"
              subtitle="Pour tester un événement"
              features={[
                "Création tournoi + équipes",
                "Planning / Matchs / Écran",
                "Résultats + classements",
                "Support email (basique)",
              ]}
              cta="Créer un compte Essai"
              onClick={() => {
                setMode("signup");
                setWantPlan("trial");
                setStatus("");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />

            <div className="rounded-3xl border border-blue-200 bg-white p-1">
              <div className="rounded-3xl bg-white p-5">
                <PriceCard
                  title="Starter"
                  price="€"
                  subtitle="Club / petit événement"
                  features={[
                    "Terrains & poules personnalisés",
                    "Auto-refresh partout",
                    "Exports PDF",
                    "Support prioritaire",
                  ]}
                  highlight
                  cta="Demander Starter"
                  onClick={() => {
                    setWantPlan("starter");
                    handleRequestPlan("starter");
                  }}
                />
              </div>
            </div>

            <PriceCard
              title="Premium"
              price="€€"
              subtitle="Tournois + sponsors + écran"
              features={[
                "Écran géant avancé",
                "Zones sponsors (logos/visuels)",
                "Statistiques enrichies",
                "Accompagnement Doppietta",
              ]}
              cta="Demander Premium"
              onClick={() => {
                setWantPlan("premium");
                handleRequestPlan("premium");
              }}
            />
          </div>

          <p className="mt-4 text-xs text-white/55">
            Tu peux remplacer les prix “€” / “€€” quand tu as finalisé ta grille.
          </p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-slate-950 border-t border-white/10">
        <div className="mx-auto max-w-7xl px-6 py-8 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <BrandMark className="opacity-90" />
          <div className="text-xs text-white/50">
            © {new Date().getFullYear()} Doppietta Gestion Tournament. Tous droits réservés.
          </div>
        </div>
      </footer>
    </main>
  );
}