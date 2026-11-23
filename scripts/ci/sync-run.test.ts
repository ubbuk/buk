import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Sync 1C workflow-ийн `run`: 1С-тэй холбогдож чадаагүй алхмыг НЭГ удаа дахин оролдоно, бусад алдааг үгүй. Жинхэнэ bash функцийг
// хуурамч командаар ажиллуулна (дахин оролдох хүлээлт 0 сек).
const hasBash = (() => {
  try {
    execFileSync("bash", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const dir = mkdtempSync(path.join(tmpdir(), "sync-run-"));
const posix = (p: string) => p.replace(/\\/g, "/");
const script = posix(path.resolve(__dirname, "sync-run.sh"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let n = 0;
/** `body` нь хуурамч алхам (bash): $ATTEMPTS нь оролдлогын тоо, $1-д оролдлогын дугаар. Буцаах: оролдлогын тоо, амжилтгүй алхмууд, run-ий код. */
function runStep(body: string, env: Record<string, string> = {}) {
  n += 1;
  const counter = posix(path.join(dir, `c${n}`));
  const step = posix(path.join(dir, `step${n}.sh`));
  writeFileSync(step, `#!/bin/bash\nN=$(cat "${counter}" 2>/dev/null || echo 0); N=$((N+1)); echo $N > "${counter}"\n${body}\n`, { mode: 0o755 });
  const out = execFileSync("bash", ["-c", `source "${script}"; failed=(); run "алхам" 30 bash "${step}" >/dev/null 2>&1; code=$?; echo "code=$code failed=\${failed[*]}"`], {
    encoding: "utf8",
    env: { ...process.env, SYNC_RETRY_DELAY: "0", ...env },
  });
  const m = /code=(\d+) failed=(.*)/.exec(out)!;
  return { attempts: Number(readFileSync(counter, "utf8").trim()), code: Number(m[1]), failed: m[2].trim() };
}

describe.skipIf(!hasBash)("sync-1c: 1С-тэй холбогдож чадаагүй алхмыг нэг удаа дахин оролдоно", () => {
  it("холбогдож чадаагүй, дараа нь амжилттай: 2 оролдлого, амжилтгүй алхам байхгүй", () => {
    const r = runStep('if [ "$N" -eq 1 ]; then echo "TypeError: fetch failed"; exit 1; fi; echo ok');
    expect(r).toEqual({ attempts: 2, code: 0, failed: "" });
  });

  it("хоёр удаа холбогдож чадаагүй: яг 2 оролдлого (гурав биш), алхам амжилтгүй", () => {
    const r = runStep('echo "Error: fetch failed"; exit 1');
    expect(r.attempts).toBe(2);
    expect(r.failed).toBe("алхам");
    expect(r.code).toBe(1);
  });

  it("1С-ийн Монгол мессежүүд: холбогдож чадсангүй, хугацаандаа хариу өгсөнгүй, timeout, ECONNRESET", () => {
    for (const msg of ["1С-тэй холбогдож чадсангүй", "1С хугацаандаа хариу өгсөнгүй (60 сек)", "The operation was aborted due to timeout", "read ECONNRESET", "connect ETIMEDOUT 10.0.0.1:80"]) {
      expect(runStep(`echo "${msg}"; exit 1`).attempts, msg).toBe(2);
    }
  });

  it("`timeout` команд хугацаанд нь дуусгаж чадаагүй (код 124) бол 1С удаан: дахин оролдоно", () => {
    expect(runStep("exit 124").attempts).toBe(2);
  });

  it("эрх, нэвтрэлтийн алдаа дахин оролдохгүй (401, 403, нэвтрэлт буруу), холбогдсон гэсэн үг байсан ч", () => {
    expect(runStep('echo "401: 1С-ийн нэр/нууц үг буруу"; exit 1').attempts).toBe(1);
    expect(runStep('echo "403 forbidden"; exit 1').attempts).toBe(1);
    expect(runStep('echo "1С-ийн техникийн хэрэглэгчийн нэвтрэлт буруу эсвэл эрхгүй байна"; echo "fetch failed"; exit 1').attempts).toBe(1);
  });

  it("код, өгөгдлийн алдаа дахин оролдохгүй (TypeError, 1С 500, хариу буруу хэлбэртэй)", () => {
    expect(runStep('echo "TypeError: x is not a function"; exit 1').attempts).toBe(1);
    expect(runStep('echo "1С алдаа буцаалаа (500)"; exit 1').attempts).toBe(1);
    expect(runStep('echo "Хариунд rows массив алга"; exit 1').attempts).toBe(1);
  });

  it("1С-ийн дуудлагын JSON лог дахь «timeout» нь алдааны мессеж биш: код алдааг дахин оролдохгүй", () => {
    const r = runStep(`echo '{"onec":"odata","target":"x","durationMs":9,"status":"timeout"}'; echo "TypeError: boom"; exit 1`);
    expect(r.attempts).toBe(1);
  });

  it("амжилттай алхам дахин ажиллахгүй", () => {
    expect(runStep("echo fine").attempts).toBe(1);
  });

  it("job-ын хугацаанд багтахгүй бол дахин оролдохгүй", () => {
    expect(runStep('echo "fetch failed"; exit 1', { SYNC_BUDGET_SECONDS: "0" }).attempts).toBe(1);
  });
});
