// 1С руу хийсэн дуудлага бүрийн хугацааг нэг мөр JSON-оор лог хийнэ (withTiming-тэй адил): 1С удаан эсэхийг лог дээрээс харахад.
// Зөвхөн объектын нэр (query, GUID, нууц үггүй), хугацаа, төлөв. Тестэд чимээгүй.
export function logOnecCall(source: "odata" | "hub", path: string, startedAt: number, status: number | string) {
  if (process.env.NODE_ENV === "test") return;
  let target = path.split("?")[0];
  try {
    target = decodeURIComponent(target);
  } catch {
    /* кодлогдсон хэвээр */
  }
  console.log(JSON.stringify({ onec: source, target: target.replace(/\(.*$/, "").slice(0, 120), durationMs: Date.now() - startedAt, status }));
}
