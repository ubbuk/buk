"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { ArrowRight, Eye, EyeOff, Loader2, Lock, User } from "lucide-react";
import "./login.css";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("И-мэйл эсвэл нууц үг буруу байна");
      return;
    }

    router.push(searchParams.get("callbackUrl") || "/dashboard");
    router.refresh();
  }

  return (
    <main className="lg-root">
      {/* small screens: the factory is only a dimmed backdrop (CSS) */}
      <div className="lg-backdrop" aria-hidden="true" />

      {/* desktop: one 16:9 stage holds the picture, the branding and the card in a single coordinate system */}
      <div className="lg-stage">
        <div className="lg-art" aria-hidden="true">
          <div className="lg-holo" />
          <div className="lg-dim">
            <span>Ø1000</span>
          </div>
          <div className="lg-dust" />
        </div>

        <header className="lg-brand">
          <div className="lg-brand-row">
            <Image src="/images/ubbuk-logo-mark.webp" alt="" width={120} height={102} priority className="lg-brand-mark" />
            <h1 className="lg-wordmark">
              <span>Улаанбаатар</span> <span>БҮК ХК</span>
            </h1>
          </div>
          <div className="lg-rule" />
          <p className="lg-tagline">Худалдан авалтын систем рүү нэвтрэх</p>
        </header>

        <section className="lg-card" aria-labelledby="login-title">
          <div className="lg-card-head">
            <Image src="/images/ubbuk-logo-mark.webp" alt="" width={120} height={102} className="lg-card-mark" />
            <h2 id="login-title" className="lg-card-title">Улаанбаатар БҮК ХК</h2>
            <p className="lg-card-sub">Худалдан авалтын систем рүү нэвтрэх</p>
          </div>

            <form onSubmit={handleSubmit}>
              <label className="lg-field">
                <span className="lg-sr">Хэрэглэгчийн и-мэйл</span>
                <User className="lg-icon" aria-hidden="true" />
                <input
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Хэрэглэгчийн и-мэйл"
                  className="lg-input"
                />
              </label>
              <label className="lg-field">
                <span className="lg-sr">Нууц үг</span>
                <Lock className="lg-icon" aria-hidden="true" />
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Нууц үг"
                  className="lg-input"
                />
                <button
                  type="button"
                  className="lg-eye"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Нууц үгийг нуух" : "Нууц үгийг харуулах"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff /> : <Eye />}
                </button>
              </label>

              {error && (
                <p role="alert" className="lg-error">
                  {error}
                </p>
              )}

              <button type="submit" className="lg-submit" disabled={loading} aria-busy={loading}>
                {loading ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                Нэвтрэх
                {!loading && <ArrowRight aria-hidden="true" />}
              </button>
            </form>
        </section>
      </div>
    </main>
  );
}
