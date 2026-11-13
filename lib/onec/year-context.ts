// Аль оны 1С баазад хандахыг (ONEC_BASES, lib/onec/bases.ts) дуудлагын гинжид дамжуулах контекст. OData дуудлага бүр (odataGet) жил заасан
// сонголтыг энэ контекстээс авдаг тул лавлах, регистрийн олон функцийн гарын үсгийг өөрчлөх шаардлагагүй. HTTP-сервис (/hs/dash)
// огноо (asof, from)-оос оныг өөрөө тодорхойлно. Контекст байхгүй бол одоогийн он.
import { AsyncLocalStorage } from "node:async_hooks";

const store = new AsyncLocalStorage<string>();

/** `fn` доторх бүх 1С дуудлагыг тухайн оны баазад чиглүүлнэ */
export function withOneCYear<T>(year: string, fn: () => Promise<T>): Promise<T> {
  return store.run(year, fn);
}

export const activeOneCYear = (): string | undefined => store.getStore();

/** "2026-11" эсвэл "2026-11-13" -> "2026" */
export const yearOf = (ymOrDate: string): string => ymOrDate.slice(0, 4);
