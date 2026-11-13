// Хүнд 1С татаалтыг (сар: sales+pl+cash, авлагын агшин зураг) Vercel-ийн route биш GitHub Actions (.github/workflows/sync-1c.yml)
// дээр ажиллуулахын тулд workflow_dispatch-ыг GitHub API-аар дууддаг. Энэ нь 1С руу хандахгүй: зөвхөн GitHub руу POST.
//
// Env: GITHUB_DISPATCH_TOKEN (fine-grained token: зөвхөн энэ репозиторийн "Actions: Read and write" эрх), GITHUB_REPOSITORY
// ("owner/repo"), GITHUB_DISPATCH_REF (анхдагч "main"). Токен хөтөч рүү, лог руу, алдааны мессеж рүү хэзээ ч гарахгүй.
type EnvLike = Record<string, string | undefined>;

export interface DispatchConfig {
  token: string;
  repo: string;
  ref: string;
}

export const WORKFLOW_FILE = "sync-1c.yml";

export function dispatchConfig(env: EnvLike = process.env): DispatchConfig | null {
  const token = env.GITHUB_DISPATCH_TOKEN?.trim();
  const repo = env.GITHUB_REPOSITORY?.trim();
  const ref = env.GITHUB_DISPATCH_REF?.trim() || "main";
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^[\w./-]+$/.test(ref)) return null;
  return { token, repo, ref };
}

/** Vercel дээр хүнд татаалтыг route дотор биш Actions-д өгнө (VERCEL=1); бусад орчинд (dev, staging, тест) route дотор ар талд ажиллана */
export type HeavyRefreshMode = "inline" | "dispatch" | "unavailable";
export function heavyRefreshMode(env: EnvLike = process.env): HeavyRefreshMode {
  if (!env.VERCEL) return "inline";
  return dispatchConfig(env) ? "dispatch" : "unavailable";
}

export class DispatchError extends Error {}

/** workflow_dispatch (мод, сар). Амжилттай бол 204. Алдаа гарвал токенгүй, ерөнхий мессеж. */
export async function dispatchSync(inputs: { mode: "month" | "receivables"; month: string }, env: EnvLike = process.env): Promise<void> {
  const cfg = dispatchConfig(env);
  if (!cfg) throw new DispatchError("GitHub Actions тохируулаагүй байна");
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${cfg.repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "ub-buk-erp",
      },
      body: JSON.stringify({ ref: cfg.ref, inputs }),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    throw new DispatchError("GitHub-тай холбогдож чадсангүй");
  }
  if (res.status !== 204) throw new DispatchError(`GitHub Actions-ийг дуудаж чадсангүй (${res.status})`);
}
