# Sync 1C workflow-ийн алхам ажиллуулагч (.github/workflows/sync-1c.yml `source`-лодог). Зөвхөн bash функцүүд, өөрөө юу ч ажиллуулахгүй.
#
# 1С үе үе унтардаг тул 1С-тэй ХОЛБОГДОЖ ЧАДААГҮЙ алхмыг (fetch failed, timeout, холбогдож чадсангүй) 2 минутын дараа НЭГ удаа дахин
# оролдоно. Бусад алдаа (код, эрх: 401/403, нэвтрэлт буруу, өгөгдлийн алдаа) дахин оролдохгүй: тэдгээр нь хүлээснээр засагдахгүй.
# Дахин оролдлого job-ын 25 минутын хязгаарт багтах үед л (SYNC_BUDGET_SECONDS).
#
# Хэрэглээ: failed=(); run <нэр> <секунд> <команд...>   → амжилтгүй алхмын нэрийг `failed` массивт нэмнэ.
SYNC_RETRY_DELAY="${SYNC_RETRY_DELAY:-120}"
SYNC_BUDGET_SECONDS="${SYNC_BUDGET_SECONDS:-1380}" # timeout-minutes: 25 (1500 сек) - нөөц

# is_connectivity_failure <код> <лог файл>: 0 = 1С-тэй холбогдож чадаагүй (дахин оролдоно), 1 = өөр алдаа
is_connectivity_failure() {
  local code=$1 log=$2 errors
  # 1С-ийн дуудлагын JSON лог ({"onec":...,"status":"timeout"}) алдааны мессеж биш: зөвхөн бусад мөрийг шалгана
  errors=$(grep -v '^{"onec"' "$log" 2>/dev/null)
  # эрх, нэвтрэлтийн алдаа: дахин оролдоход засагдахгүй
  if printf '%s\n' "$errors" | grep -qiE '\b(401|403)\b|нэвтрэлт буруу|эрхгүй|forbidden|unauthori[sz]ed'; then return 1; fi
  # `timeout` команд алхмыг хугацаанд нь дуусгаж чадаагүй (1С удаан)
  if [ "$code" -eq 124 ]; then return 0; fi
  printf '%s\n' "$errors" | grep -qiE 'fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|UND_ERR|timed out|timeout|холбогдож чадсангүй|холбогдсонгүй|хугацаандаа хариу өгсөнгүй'
}

run() { # run <нэр> <секунд> <команд...>
  local name=$1 secs=$2 attempt=1 code log
  shift 2
  while :; do
    echo "::group::$name$([ "$attempt" -gt 1 ] && echo ' (дахин оролдлого)')"
    log=$(mktemp)
    timeout "$secs" "$@" 2>&1 | tee "$log"
    code=${PIPESTATUS[0]}
    echo "::endgroup::"
    if [ "$code" -eq 0 ]; then
      rm -f "$log"
      return 0
    fi
    if [ "$attempt" -eq 1 ] && is_connectivity_failure "$code" "$log" && [ $((SECONDS + SYNC_RETRY_DELAY + secs)) -le "$SYNC_BUDGET_SECONDS" ]; then
      echo "::notice title=1С sync: $name::1С-тэй холбогдож чадсангүй (код $code). ${SYNC_RETRY_DELAY} секундийн дараа нэг удаа дахин оролдоно"
      rm -f "$log"
      sleep "$SYNC_RETRY_DELAY"
      attempt=2
      continue
    fi
    rm -f "$log"
    echo "::warning title=1С sync: $name::код $code (1С унтарсан байж магадгүй; onec_sync_log-ийг үзнэ үү)"
    failed+=("$name")
    return "$code"
  done
}
