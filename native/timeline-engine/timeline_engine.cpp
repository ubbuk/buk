
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <numbers>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

namespace {

constexpr double kTwoPi = 2.0 * std::numbers::pi;
constexpr double kStep = 1.0 / 120.0;   
constexpr double kMaxFrame = 0.1;       
constexpr double kSecondsPerDay = 86400.0;

constexpr int kRings = 4;
constexpr int kGears = 6;


constexpr std::array<double, kRings> kRingRatio{0.35, -0.55, 0.80, -1.20};
constexpr std::array<double, kRings> kRingIdle{0.050, -0.035, 0.070, -0.045};

constexpr std::array<int, kGears> kTeeth{24, 12, 18, 12, 24, 16};
constexpr std::array<int, kGears> kMesh{1, -1, -1, -1, 1, -1};
constexpr double kGearBase = 1.6;       
constexpr double kGearIdle = 0.06;      


enum Value : int {
  kPosition = 0,   
  kDirection = 1,  
  kSpeed = 2,      
  kPlaying = 3,
  kAtStart = 4,
  kAtEnd = 5,
  kRing0 = 6,     
  kGear0 = 10,     
  kHourHand = 16,
  kMinuteHand = 17,
  kSecondHand = 18,
  kMomentEpoch = 19, 
  kSteps = 20,       
  kValueCount = 21,
};

struct Engine {
  double rangeDays = 30.0;
  double nowEpoch = 0.0;
  double utcOffset = 0.0;
  double position = 1.0;
  int direction = -1;
  double speed = 1.0;
  bool playing = false;
  bool idle = true;
  double accumulator = 0.0;
  double alpha = 0.0;  
  std::int64_t steps = 0;
  std::array<double, kRings> ringAngle{};
  std::array<double, kRings> ringVel{};
  std::array<double, kGears> gearAngle{};
  std::array<double, kGears> gearVel{};
};

Engine g;

double wrap(double a) {
  a = std::fmod(a, kTwoPi);
  return a < 0.0 ? a + kTwoPi : a;
}

double momentEpoch() { return g.nowEpoch - (1.0 - g.position) * g.rangeDays * kSecondsPerDay; }

double dayFraction(double period) {
  const double local = momentEpoch() + g.utcOffset;
  double r = std::fmod(local, period);
  if (r < 0.0) r += period;
  return r / period;
}

void step() {
  
  const double v = g.playing ? g.direction * g.speed : 0.0;
  if (g.playing) {
    g.position += v * kStep / g.rangeDays;
    if (g.position <= 0.0) {
      g.position = 0.0;
      g.playing = false;
    } else if (g.position >= 1.0) {
      g.position = 1.0;
      g.playing = false;
    }
  }
  for (int i = 0; i < kRings; ++i) {
    const double target = v * kRingRatio[i] + (g.idle ? kRingIdle[i] : 0.0);
    g.ringVel[i] += (target - g.ringVel[i]) * g.alpha;
    g.ringAngle[i] = wrap(g.ringAngle[i] + g.ringVel[i] * kStep);
  }
  for (int i = 0; i < kGears; ++i) {
    const double ratio = 24.0 / static_cast<double>(kTeeth[i]) * kMesh[i];
    const double target = (v * kGearBase + (g.idle ? kGearIdle : 0.0)) * ratio;
    g.gearVel[i] += (target - g.gearVel[i]) * g.alpha;
    g.gearAngle[i] = wrap(g.gearAngle[i] + g.gearVel[i] * kStep);
  }
  ++g.steps;
}

}  

extern "C" {


EMSCRIPTEN_KEEPALIVE void tm_init(double rangeDays, double nowEpochSeconds, double utcOffsetSeconds) {
  g = Engine{};
  g.rangeDays = rangeDays > 0.0 ? rangeDays : 30.0;
  g.nowEpoch = nowEpochSeconds;
  g.utcOffset = utcOffsetSeconds;
  g.alpha = 1.0 - std::exp(-kStep * 3.0);
}

EMSCRIPTEN_KEEPALIVE void tm_set_direction(int direction) { g.direction = direction >= 0 ? 1 : -1; }

EMSCRIPTEN_KEEPALIVE void tm_set_speed(double daysPerSecond) {
  g.speed = std::clamp(daysPerSecond, 0.0, 64.0);
}

EMSCRIPTEN_KEEPALIVE void tm_set_playing(int playing) {
  if (!playing) {
    g.playing = false;
    return;
  }
 
  const bool blocked = (g.direction < 0 && g.position <= 0.0) || (g.direction > 0 && g.position >= 1.0);
  g.playing = !blocked;
}

EMSCRIPTEN_KEEPALIVE void tm_set_position(double position) { g.position = std::clamp(position, 0.0, 1.0); }


EMSCRIPTEN_KEEPALIVE void tm_set_idle(int idle) { g.idle = idle != 0; }


EMSCRIPTEN_KEEPALIVE void tm_tick(double dt) {
  if (!(dt > 0.0)) return;
  g.accumulator += std::min(dt, kMaxFrame);
  while (g.accumulator >= kStep) {
    step();
    g.accumulator -= kStep;
  }
}

EMSCRIPTEN_KEEPALIVE double tm_value(int id) {
  switch (id) {
    case kPosition: return g.position;
    case kDirection: return static_cast<double>(g.direction);
    case kSpeed: return g.speed;
    case kPlaying: return g.playing ? 1.0 : 0.0;
    case kAtStart: return g.position <= 0.0 ? 1.0 : 0.0;
    case kAtEnd: return g.position >= 1.0 ? 1.0 : 0.0;
    case kHourHand: return dayFraction(43200.0) * kTwoPi;
    case kMinuteHand: return dayFraction(3600.0) * kTwoPi;
    case kSecondHand: return dayFraction(60.0) * kTwoPi;
    case kMomentEpoch: return momentEpoch();
    case kSteps: return static_cast<double>(g.steps);
    default: break;
  }
  if (id >= kRing0 && id < kRing0 + kRings) return g.ringAngle[static_cast<std::size_t>(id - kRing0)];
  if (id >= kGear0 && id < kGear0 + kGears) return g.gearAngle[static_cast<std::size_t>(id - kGear0)];
  return 0.0;
}

} 
