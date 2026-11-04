// Historical reconstruction engine (C++20 -> WebAssembly, executed server-side).
//
// Replays material-request audit events up to a chosen moment and reports each
// request's reconstructed status, how long it has been waiting there, and
// per-stage waiting statistics. It is deterministic (stable ordering, integer
// milliseconds, no clocks, no randomness) and never invents history: whenever
// the audit trail cannot explain a state the request is flagged, and the caller
// reports the reconstruction as incomplete.
//
// The state machine mirrors lib/workflow.ts (see lib/monitoring/history/codes.ts
// for the shared numeric codes). The same algorithm lives in
// lib/monitoring/history/engine-js.ts (reference + fallback); tests assert both
// agree, so keep them in sync.
//
// Build: native/history-engine/build.sh  (+ embed.mjs to refresh the embedded module)

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

namespace {

constexpr int kVersion = 1;

// RequestStatus codes (same order as RequestStatus in lib/types.ts).
enum Status : int {
  DRAFT = 0,
  PENDING_DEPARTMENT = 1,
  RETURNED_DEPARTMENT = 2,
  PENDING_WAREHOUSE = 3,
  PENDING_BRANCH = 4,
  RETURNED_BRANCH = 5,
  PENDING_FINANCE = 6,
  RETURNED_FINANCE = 7,
  PENDING_EXECUTIVE = 8,
  RETURNED_EXECUTIVE = 9,
  PENDING_ACCOUNTING = 10,
  ACCOUNTING_COMPLETED = 11,
  PARTIALLY_COMPLETED = 12,
  COMPLETED = 13,
  CANCELLED = 14,
  UNKNOWN = 15,
  kStatusCount = 16,
};

enum Action : int {
  SUBMIT = 0,
  APPROVE = 1,
  RETURN = 2,
  RESUBMIT = 3,
  RESERVE_STOCK = 4,
  ACCOUNTING_RECORD = 5,
  CANCEL = 6,
  REJECT = 7,
};

enum Flag : std::uint32_t {
  F_NO_HISTORY = 1,        // request existed but no audit event explains any state
  F_UNEXPLAINED = 2,       // an event did not fit the workflow from the prior state
  F_AMBIGUOUS = 4,         // warehouse outcome could not be decided from the data
  F_MISMATCH_CURRENT = 8,  // no later events, yet the result differs from the live status
  F_DUPLICATE = 16,        // identical (time, action) event collapsed
  F_OUT_OF_ORDER = 32,     // events arrived out of time order (re-sorted)
  F_SAME_TIME = 64,        // distinct events share one timestamp (input order used)
};

struct Req {
  double createdAt = 0;
  int currentStatus = UNKNOWN;
  int status = UNKNOWN;
  double since = -1;
  std::uint32_t flags = 0;
  int applied = 0;
  int later = 0;
};

struct Ev {
  int req;
  int action;
  double time;
  int hint;
  int seq;
  bool skip;
};

constexpr int kPendingStatuses[] = {PENDING_DEPARTMENT, PENDING_WAREHOUSE, PENDING_BRANCH,
                                    PENDING_FINANCE, PENDING_EXECUTIVE, PENDING_ACCOUNTING};

struct StageStat {
  double count = 0, sum = 0, avg = 0, median = 0, max = 0;
};

struct Engine {
  double asOf = 0;
  std::vector<Req> reqs;
  std::vector<Ev> evs;
  // counters (ids 0..7 of he_counter)
  double inputEvents = 0, appliedEvents = 0, futureEvents = 0, duplicates = 0;
  double outOfOrder = 0, sameTime = 0, unexplained = 0, ambiguous = 0;
  double statusCount[kStatusCount] = {};
  StageStat stage[kStatusCount];
  std::uint32_t hashHi = 0, hashLo = 0;
};

Engine g;

bool isPendingStatus(int s) {
  for (int p : kPendingStatuses)
    if (p == s) return true;
  return false;
}

// Next status for an event, or UNKNOWN when the workflow cannot explain it.
// `explained` is false when the event does not fit; `ambiguous` when the data
// offered two possible outcomes and no usable hint.
int nextStatus(int prev, int action, int hint, bool& explained, bool& ambiguous) {
  explained = true;
  ambiguous = false;
  switch (action) {
    case SUBMIT:
      return PENDING_DEPARTMENT;
    case CANCEL:
      return CANCELLED;
    case APPROVE:
      switch (prev) {
        case PENDING_DEPARTMENT: return PENDING_WAREHOUSE;
        case PENDING_BRANCH: return PENDING_FINANCE;
        case PENDING_FINANCE: return PENDING_EXECUTIVE;
        case PENDING_EXECUTIVE: return PENDING_ACCOUNTING;
        default: break;
      }
      break;
    case RETURN:
      switch (prev) {
        case PENDING_DEPARTMENT: return RETURNED_DEPARTMENT;
        case PENDING_BRANCH: return RETURNED_BRANCH;
        case PENDING_FINANCE: return RETURNED_FINANCE;
        case PENDING_EXECUTIVE: return RETURNED_EXECUTIVE;
        default: break;
      }
      break;
    case RESUBMIT:
      switch (prev) {
        case RETURNED_DEPARTMENT: return PENDING_DEPARTMENT;
        case RETURNED_BRANCH: return PENDING_BRANCH;
        case RETURNED_FINANCE: return PENDING_FINANCE;
        case RETURNED_EXECUTIVE: return PENDING_EXECUTIVE;
        default: break;
      }
      break;
    case RESERVE_STOCK:
      if (prev == PENDING_WAREHOUSE) {
        if (hint == PENDING_BRANCH || hint == COMPLETED) return hint;
        explained = true;
        ambiguous = true;
        return UNKNOWN;
      }
      break;
    case ACCOUNTING_RECORD:
      if (prev == PENDING_ACCOUNTING) return ACCOUNTING_COMPLETED;
      break;
    default:
      break;  // REJECT and anything unmodelled
  }
  explained = false;
  return UNKNOWN;
}

void fnv(std::uint64_t& h, std::uint64_t v) {
  for (int i = 0; i < 8; ++i) {
    h ^= (v >> (i * 8)) & 0xffu;
    h *= 1099511628211ull;
  }
}

double medianOf(std::vector<double>& v) {
  if (v.empty()) return 0;
  std::sort(v.begin(), v.end());
  const std::size_t mid = v.size() / 2;
  return v.size() % 2 ? v[mid] : std::round((v[mid - 1] + v[mid]) / 2.0);
}

void run() {
  const std::size_t n = g.reqs.size();
  // Bucket events per request, keeping input order (counting sort).
  std::vector<std::size_t> start(n + 1, 0);
  for (const Ev& e : g.evs)
    if (e.req >= 0 && static_cast<std::size_t>(e.req) < n) ++start[static_cast<std::size_t>(e.req) + 1];
  for (std::size_t i = 0; i < n; ++i) start[i + 1] += start[i];
  std::vector<std::size_t> order(start[n]);
  {
    std::vector<std::size_t> cursor(start.begin(), start.end() - 1);
    for (std::size_t i = 0; i < g.evs.size(); ++i) {
      const Ev& e = g.evs[i];
      if (e.req >= 0 && static_cast<std::size_t>(e.req) < n) order[cursor[static_cast<std::size_t>(e.req)]++] = i;
    }
  }

  std::vector<std::vector<double>> waits(kStatusCount);

  for (std::size_t r = 0; r < n; ++r) {
    Req& q = g.reqs[r];
    const auto first = order.begin() + static_cast<std::ptrdiff_t>(start[r]);
    const auto last = order.begin() + static_cast<std::ptrdiff_t>(start[r + 1]);

    // Out-of-order arrivals (input order vs. time).
    double maxSeen = -1e300;
    for (auto it = first; it != last; ++it) {
      const double t = g.evs[*it].time;
      if (t < maxSeen) {
        q.flags |= F_OUT_OF_ORDER;
        g.outOfOrder += 1;
      }
      maxSeen = std::max(maxSeen, t);
    }

    // Deterministic replay order: by time, ties by input position.
    std::sort(first, last, [](std::size_t a, std::size_t b) {
      const Ev& x = g.evs[a];
      const Ev& y = g.evs[b];
      if (x.time != y.time) return x.time < y.time;
      return x.seq < y.seq;
    });

    // Collapse exact duplicates; note distinct events sharing a timestamp.
    for (auto it = first; it != last; ++it) {
      if (it == first) continue;
      Ev& cur = g.evs[*it];
      const Ev& prev = g.evs[*(it - 1)];
      if (cur.time == prev.time) {
        if (cur.action == prev.action) {
          cur.skip = true;
          q.flags |= F_DUPLICATE;
          g.duplicates += 1;
        } else {
          q.flags |= F_SAME_TIME;
          g.sameTime += 1;
        }
      }
    }

    int status = UNKNOWN;
    double since = -1;
    for (auto it = first; it != last; ++it) {
      const Ev& e = g.evs[*it];
      if (e.skip) continue;
      if (e.time > g.asOf) {
        ++q.later;
        g.futureEvents += 1;
        continue;
      }
      bool explained = true, ambiguous = false;
      const int next = nextStatus(status, e.action, e.hint, explained, ambiguous);
      ++q.applied;
      g.appliedEvents += 1;
      if (!explained) {
        q.flags |= F_UNEXPLAINED;
        g.unexplained += 1;
        status = UNKNOWN;
      } else if (ambiguous) {
        q.flags |= F_AMBIGUOUS;
        g.ambiguous += 1;
        status = UNKNOWN;
      } else {
        status = next;
      }
      since = e.time;
    }

    if (q.applied == 0) {
      q.flags |= F_NO_HISTORY;
      status = UNKNOWN;
      since = -1;
    }
    q.status = status;
    q.since = since;

    // The reconstruction must agree with the live status when nothing happened later.
    if (q.later == 0 && status != UNKNOWN && status != q.currentStatus) q.flags |= F_MISMATCH_CURRENT;

    g.statusCount[status] += 1;
    if (isPendingStatus(status) && since >= 0) {
      const double w = std::max(0.0, std::floor((g.asOf - since) / 1000.0));
      waits[status].push_back(w);
    }
  }

  for (int s : kPendingStatuses) {
    std::vector<double>& v = waits[s];
    StageStat& st = g.stage[s];
    st.count = static_cast<double>(v.size());
    if (v.empty()) continue;
    double sum = 0, mx = 0;
    for (double w : v) {
      sum += w;
      mx = std::max(mx, w);
    }
    st.sum = sum;
    st.avg = std::round(sum / st.count);
    st.max = mx;
    st.median = medianOf(v);
  }

  std::uint64_t h = 1469598103934665603ull;
  fnv(h, static_cast<std::uint64_t>(kVersion));
  for (const Req& q : g.reqs) {
    fnv(h, static_cast<std::uint64_t>(q.status));
    fnv(h, static_cast<std::uint64_t>(static_cast<std::int64_t>(q.since)));
    fnv(h, q.flags);
  }
  fnv(h, static_cast<std::uint64_t>(g.appliedEvents));
  g.hashHi = static_cast<std::uint32_t>(h >> 32);
  g.hashLo = static_cast<std::uint32_t>(h & 0xffffffffu);
}

}  // namespace

extern "C" {

EMSCRIPTEN_KEEPALIVE int he_version() { return kVersion; }

EMSCRIPTEN_KEEPALIVE void he_begin(int requestCount, int eventCount, double asOfMs) {
  g = Engine{};
  g.asOf = asOfMs;
  g.reqs.assign(static_cast<std::size_t>(std::max(0, requestCount)), Req{});
  g.evs.clear();
  g.evs.reserve(static_cast<std::size_t>(std::max(0, eventCount)));
}

EMSCRIPTEN_KEEPALIVE void he_set_request(int index, double createdAtMs, int currentStatus) {
  if (index < 0 || static_cast<std::size_t>(index) >= g.reqs.size()) return;
  Req& r = g.reqs[static_cast<std::size_t>(index)];
  r.createdAt = createdAtMs;
  r.currentStatus = currentStatus;
}

EMSCRIPTEN_KEEPALIVE void he_add_event(int requestIndex, int action, double timeMs, int hintStatus) {
  const int seq = static_cast<int>(g.evs.size());
  g.evs.push_back(Ev{requestIndex, action, timeMs, hintStatus, seq, false});
  g.inputEvents += 1;
}

EMSCRIPTEN_KEEPALIVE void he_run() { run(); }

EMSCRIPTEN_KEEPALIVE int he_req_status(int i) { return g.reqs[static_cast<std::size_t>(i)].status; }
EMSCRIPTEN_KEEPALIVE double he_req_since(int i) { return g.reqs[static_cast<std::size_t>(i)].since; }
EMSCRIPTEN_KEEPALIVE int he_req_flags(int i) { return static_cast<int>(g.reqs[static_cast<std::size_t>(i)].flags); }

EMSCRIPTEN_KEEPALIVE double he_status_count(int status) {
  return status >= 0 && status < kStatusCount ? g.statusCount[status] : 0;
}

// which: 0 count, 1 sum(s), 2 average(s), 3 median(s), 4 max(s)
EMSCRIPTEN_KEEPALIVE double he_stage_stat(int status, int which) {
  if (status < 0 || status >= kStatusCount) return 0;
  const StageStat& s = g.stage[status];
  switch (which) {
    case 0: return s.count;
    case 1: return s.sum;
    case 2: return s.avg;
    case 3: return s.median;
    case 4: return s.max;
    default: return 0;
  }
}

// 0 input, 1 applied, 2 future (ignored), 3 duplicates, 4 out-of-order, 5 same-time, 6 unexplained, 7 ambiguous
EMSCRIPTEN_KEEPALIVE double he_counter(int id) {
  switch (id) {
    case 0: return g.inputEvents;
    case 1: return g.appliedEvents;
    case 2: return g.futureEvents;
    case 3: return g.duplicates;
    case 4: return g.outOfOrder;
    case 5: return g.sameTime;
    case 6: return g.unexplained;
    case 7: return g.ambiguous;
    default: return 0;
  }
}

EMSCRIPTEN_KEEPALIVE double he_hash_hi() { return static_cast<double>(g.hashHi); }
EMSCRIPTEN_KEEPALIVE double he_hash_lo() { return static_cast<double>(g.hashLo); }

}  // extern "C"
