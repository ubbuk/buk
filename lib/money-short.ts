// Дүнг удирдлагад ойлгомжтой хэлбэрээр: «84.1 сая₮», «1.18 тэрбум₮», «12.4 мянга₮». Бүтэн тоо нь дарахад (formatMoneyFull).
const SIGN = (v: number) => (v < 0 ? "−" : "");

export function formatMoneyShort(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${SIGN(value)}${(abs / 1e9).toFixed(2)} тэрбум₮`;
  if (abs >= 1e6) return `${SIGN(value)}${(abs / 1e6).toFixed(1)} сая₮`;
  if (abs >= 1e4) return `${SIGN(value)}${(abs / 1e3).toFixed(1)} мянга₮`;
  return `${SIGN(value)}${new Intl.NumberFormat("mn-MN", { maximumFractionDigits: 0 }).format(abs)}₮`;
}

/** Бүтэн дүн (тоосонцороор): «84,073,015.25₮» */
export function formatMoneyFull(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${SIGN(value)}${new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Math.abs(value))}₮`;
}

/** График тэнхлэгийн шошго: «40 тэрбум», «250 сая», «12 мянга» (өмнө нь «40B»). Төгрөгийн тэмдэггүй, хураангуй. */
export function formatAxisValue(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  const trim = (n: number) => String(Number(n.toFixed(1)));
  if (abs >= 1e9) return `${sign}${trim(abs / 1e9)} тэрбум`;
  if (abs >= 1e6) return `${sign}${trim(abs / 1e6)} сая`;
  if (abs >= 1e4) return `${sign}${trim(abs / 1e3)} мянга`;
  return `${sign}${new Intl.NumberFormat("mn-MN", { maximumFractionDigits: 1 }).format(abs)}`;
}
