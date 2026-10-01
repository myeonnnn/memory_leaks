import { scenarios } from './scenarios';
import type { Gauge, LeakMode } from './scenarios/types';
import { stream } from './sim/sensorStream';

export type LabState = {
  modes: Record<string, LeakMode>;
  /** 모드를 바꾼 시각 (경과 시간 표시용) */
  changedAt: Record<string, number>;
  speed: number;
  streaming: boolean;
};

let state: LabState = {
  modes: Object.fromEntries(scenarios.map((s) => [s.id, 'off' as LeakMode])),
  changedAt: {},
  speed: stream.speed,
  streaming: false,
};
const subscribers = new Set<() => void>();

function update(patch: Partial<LabState>) {
  state = { ...state, ...patch };
  for (const notify of subscribers) notify();
}

function scenarioById(id: string) {
  const scenario = scenarios.find((s) => s.id === id);
  if (!scenario) throw new Error(`unknown scenario: ${id}`);
  return scenario;
}

/** 화면과 측정 스크립트(Playwright)가 같이 쓰는 조작 API. window.__lab으로도 열려 있다 */
export const lab = {
  getState: () => state,

  subscribe(notify: () => void) {
    subscribers.add(notify);
    return () => {
      subscribers.delete(notify);
    };
  },

  scenarios: () =>
    scenarios.map(({ id, title, speed, hiddenByForcedGc = false }) => ({ id, title, speed, hiddenByForcedGc })),

  setMode(id: string, mode: LeakMode) {
    const scenario = scenarioById(id);
    const previous = state.modes[id];
    if (previous === mode) return;
    if (previous !== 'off') scenario.stop?.();
    if (mode !== 'off') scenario.start?.(mode);
    update({ modes: { ...state.modes, [id]: mode }, changedAt: { ...state.changedAt, [id]: Date.now() } });
  },

  setSpeed(speed: number) {
    stream.speed = speed;
    update({ speed });
  },

  setStreaming(on: boolean) {
    if (on) stream.start();
    else stream.stop();
    update({ streaming: on });
  },

  gauges: (id: string): Gauge[] => scenarioById(id).gauges(),
};

export type LabApi = typeof lab;

declare global {
  interface Window {
    __lab: LabApi;
  }
}

window.__lab = lab;
lab.setStreaming(true);
