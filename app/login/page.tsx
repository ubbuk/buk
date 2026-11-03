"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Factory, LogIn } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import StrokeText from "@/components/ui/StrokeText";

const DEMO_ACCOUNTS = [
  { email: "tumurbaatar@ubbuk.mn", label: "Ажилтан — Б.Төмөрбаатар" },
  { email: "bold@ubbuk.mn", label: "Цехийн дарга — Ц.Болд (Бетон цех)" },
  { email: "sarnai@ubbuk.mn", label: "Нярав — Г.Сарнай" },
  { email: "narmandakh@ubbuk.mn", label: "Ерөнхий инженер — Б.Нармандах" },
  { email: "khuntsengel@ubbuk.mn", label: "Үйл ажиллагаа эрхэлсэн захирал — Н.Хүнцэнгэл" },
  { email: "magomed@ubbuk.mn", label: "Санхүү эрхэлсэн захирал — Хамхоев Магомед" },
  { email: "ganbold@ubbuk.mn", label: "Гүйцэтгэх захирал — Ганболд" },
  { email: "nomintuya@ubbuk.mn", label: "Ерөнхий нягтлан бодогч — Номинтуяа" },
];

const DEMO_PASSWORD = "ubbuk2026";

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
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-12 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <Factory className="size-6" />
          </div>
          <StrokeText
            text="УБ БҮК ХК"
            trigger="mount"
            fillMode="wipe"
            wipeFrom="left"
            strokeColor="#F59E0B"
            fontSize={32}
            fontWeight={700}
            letterSpacing={-0.5}
            drawDuration={1.1}
            fillDelay={0.1}
            className="max-w-[220px]"
          />
          <p className="text-sm text-text-muted">Худалдан авалтын систем рүү нэвтрэх</p>
        </div>

        <Card>
          <CardBody className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-muted">И-мэйл</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ажилтны@ubbuk.mn"
                  className="focus-ring h-10 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text placeholder:text-text-muted"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-text-muted">Нууц үг</span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="focus-ring h-10 w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-text"
                />
              </label>
              {error && <p className="text-xs text-danger">{error}</p>}
              <Button type="submit" className="w-full" loading={loading}>
                <LogIn className="size-4" />
                Нэвтрэх
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardBody className="space-y-2">
            <p className="text-xs font-medium text-text-muted">
              Жишээ бүртгэлүүд (нууц үг бүгдэд адил: <span className="text-text">{DEMO_PASSWORD}</span>)
            </p>
            <ul className="space-y-1">
              {DEMO_ACCOUNTS.map((a) => (
                <li key={a.email}>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail(a.email);
                      setPassword(DEMO_PASSWORD);
                    }}
                    className="focus-ring w-full rounded-lg px-2 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-bg-elevated hover:text-text"
                  >
                    <span className="text-text">{a.email}</span> — {a.label}
                  </button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
