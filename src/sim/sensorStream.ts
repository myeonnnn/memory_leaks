import { Emitter } from './emitter';

/** 스트림으로 들어오는 값 하나 (가속도·회전 센서 형태) */
export type MotionSample = {
  /** 시뮬레이션 시각 (ms) */
  t: number;
  /** 중력 포함 가속도 (m/s²) */
  ax: number;
  ay: number;
  az: number;
  /** 회전 속도 (deg/s) */
  gx: number;
  gy: number;
  gz: number;
};

/** Geolocation API에 해당하는 값. sog는 대지속력(kn), cog는 대지침로(deg) */
export type GpsFix = { t: number; lat: number; lon: number; sog: number; cog: number };

type SensorEvents = { motion: MotionSample; gps: GpsFix };

const MOTION_HZ = 60;
const GPS_HZ = 1;
const TICK_MS = 16;
/** 탭이 백그라운드였다가 돌아와도 한 틱에 폭주하지 않게 막는 상한 */
const MAX_SAMPLES_PER_TICK = 20_000;

const DEG = Math.PI / 180;
const ROLL_PERIOD_S = 8;
const PITCH_PERIOD_S = 5.5;
const ROLL_AMPLITUDE = 12;
const PITCH_AMPLITUDE = 4;

const noise = (scale: number) => (Math.random() - 0.5) * 2 * scale;

/** 느리게 흔들리는 사인파 두 개에 잡음을 섞는다 */
function motionAt(t: number): MotionSample {
  const s = t / 1000;
  const rollPhase = (2 * Math.PI * s) / ROLL_PERIOD_S;
  const pitchPhase = (2 * Math.PI * s) / PITCH_PERIOD_S;
  const roll = ROLL_AMPLITUDE * Math.sin(rollPhase);
  const pitch = PITCH_AMPLITUDE * Math.sin(pitchPhase);
  return {
    t,
    ax: 9.81 * Math.sin(roll * DEG) + noise(0.2),
    ay: 9.81 * Math.sin(pitch * DEG) + noise(0.2),
    az: 9.81 * Math.cos(roll * DEG) + noise(0.2),
    gx: ((2 * Math.PI) / ROLL_PERIOD_S) * ROLL_AMPLITUDE * Math.cos(rollPhase) + noise(0.5),
    gy: ((2 * Math.PI) / PITCH_PERIOD_S) * PITCH_AMPLITUDE * Math.cos(pitchPhase) + noise(0.5),
    gz: noise(0.3),
  };
}

/** 원을 그리며 움직이는 위치 */
function gpsAt(t: number): GpsFix {
  const angle = (t / 1000 / 600) * 2 * Math.PI; // 10분에 한 바퀴
  return {
    t,
    lat: 35.08 + 0.01 * Math.sin(angle),
    lon: 129.08 + 0.012 * Math.cos(angle),
    sog: 8 + noise(0.3),
    cog: ((angle / DEG + 90) % 360 + 360) % 360,
  };
}

/**
 * 초당 60번 값을 내보내는 가짜 데이터 스트림.
 * 실제 시간 대비 speed 배속으로 시뮬레이션 시간을 흘려서, 며칠 치 누수를 몇 분 안에 재현한다.
 */
export class SensorStream extends Emitter<SensorEvents> {
  speed = 1;
  /** 지금까지 내보낸 모션 샘플 수 (초당 처리량 계산용) */
  emitted = 0;

  private timer: number | undefined;
  private lastTick = 0;
  private simTime = 0;
  private motionDue = 0;
  private gpsDue = 0;

  get running(): boolean {
    return this.timer !== undefined;
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.lastTick = performance.now();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.timer = undefined;
  }

  private tick(): void {
    const now = performance.now();
    const elapsed = (now - this.lastTick) * this.speed;
    this.lastTick = now;
    const from = this.simTime;
    this.simTime += elapsed;

    this.motionDue += (elapsed * MOTION_HZ) / 1000;
    const motionCount = Math.min(Math.floor(this.motionDue), MAX_SAMPLES_PER_TICK);
    this.motionDue -= Math.floor(this.motionDue);
    for (let i = 1; i <= motionCount; i++) {
      this.emit('motion', motionAt(from + (elapsed * i) / motionCount));
    }
    this.emitted += motionCount;

    this.gpsDue += (elapsed * GPS_HZ) / 1000;
    const gpsCount = Math.min(Math.floor(this.gpsDue), MAX_SAMPLES_PER_TICK);
    this.gpsDue -= Math.floor(this.gpsDue);
    for (let i = 1; i <= gpsCount; i++) {
      this.emit('gps', gpsAt(from + (elapsed * i) / gpsCount));
    }
  }
}

/** 앱 전체가 공유하는 연결. 전역 소켓처럼 어떤 화면보다 오래 산다 */
export const stream = new SensorStream();
