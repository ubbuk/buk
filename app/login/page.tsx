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

    // iOS keyboards/autofill can leave stray whitespace or capitalise the
    // first letter of the email; normalise it before it is sent.
    let result: Awaited<ReturnType<typeof signIn>>;
    try {
      result = await signIn("credentials", {
        email: email.normalize("NFKC").trim().toLowerCase(),
        password,
        redirect: false,
      });
    } catch {
      setLoading(false);
      setError("Сервертэй холбогдож чадсангүй. Дахин оролдоно уу");
      return;
    }

    setLoading(false);

    if (!result || result.error) {
      // Only CredentialsSignin means a genuine bad email/password; anything
      // else (config, CSRF, DB, network) is not the user's typing mistake.
      setError(
        !result || result.error === "CredentialsSignin"
          ? "И-мэйл эсвэл нууц үг буруу байна"
          : "Нэвтрэх үед системийн алдаа гарлаа. Дахин оролдоно уу"
      );
      return;
    }

    router.push(searchParams.get("callbackUrl") || "/dashboard");
    router.refresh();
  }

  return (
    <main className="lg-root">
      <section className="lg-card" aria-labelledby="login-title">
        <div className="lg-card-head">
          <Image src="/images/ubbuk-logo-mark.webp" alt="" width={120} height={102} priority className="lg-card-mark" />
          <h1 id="login-title" className="lg-card-title">Улаанбаатар БҮК ХК</h1>
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
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode="email"
              name="email"
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
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              name="password"
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
    </main>
  );
}
