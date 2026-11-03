import { REQUEST_STATUS_LABEL, type RequestStatus } from "@/lib/types";
import { MONITORING_TZ } from "@/lib/monitoring/time";

// Always Ulaanbaatar time, whatever the viewer's own browser zone is.
const dateTime = new Intl.DateTimeFormat("sv-SE", {
  timeZone: MONITORING_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const timeOnly = new Intl.DateTimeFormat("sv-SE", {
  timeZone: MONITORING_TZ,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export const formatUB = (iso: string | number | Date) => dateTime.format(new Date(iso));
export const formatUBTime = (value: number | Date) => timeOnly.format(value);

export function formatDuration(seconds: number): string {
  if (seconds < 60) return "< 1 мин";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} цаг ${minutes % 60} мин`;
  const days = Math.floor(hours / 24);
  return `${days} өдөр ${hours % 24} цаг`;
}

export type WaitTone = "text-text" | "text-warning" | "text-danger";
export function waitTone(seconds: number): WaitTone {
  if (seconds >= 48 * 3600) return "text-danger";
  if (seconds >= 24 * 3600) return "text-warning";
  return "text-text";
}

export const statusLabel = (status: string) => REQUEST_STATUS_LABEL[status as RequestStatus] ?? status;

export const ACTION_LABEL: Record<string, string> = {
  CREATE: "Үүсгэсэн",
  UPDATE: "Өөрчилсөн",
  SUBMIT: "Илгээсэн",
  APPROVE: "Баталсан",
  REJECT: "Татгалзсан",
  RETURN: "Буцаасан",
  RESERVE_STOCK: "Нөөц тусгаарласан",
  ISSUE_STOCK: "Бараа олгосон",
  ACCOUNTING_RECORD: "Санхүүд бүртгэсэн",
  CANCEL: "Цуцалсан",
  PIN_SETUP: "PIN тохируулсан",
  PIN_FAILURE: "PIN алдсан",
  PIN_LOCKOUT: "PIN түгжигдсэн",
  RESUBMIT: "Дахин илгээсэн",
  CREATE_USER: "Хэрэглэгч үүсгэсэн",
  UPDATE_USER: "Хэрэглэгч засварласан",
  RESET_CREDENTIALS: "Нууц үг сэргээсэн",
  CHANGE_PASSWORD: "Нууц үг солисон",
  UPDATE_PRICE: "Үнэ өөрчилсөн",
  ATTACHMENT_UPLOAD: "Файл хавсаргасан",
  VIEW_MONITORING: "Мониторинг үзсэн",
  MONITORING_ACCESS_DENIED: "Мониторинг хандалт татгалзсан",
};

export const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Админ",
  DIRECTOR: "Захирал",
  BOSS: "Дарга",
  MANAGER: "Менежер",
  STOREKEEPER: "Нярав",
  EMPLOYEE: "Ажилтан",
  ENGINEERING: "Инженер",
  CHIEF_ACCOUNTANT: "Ерөнхий нягтлан",
};
