import { scenarios } from '../scenarios';
import { stream } from '../sim/sensorStream';

/** performance.memory는 크롬 전용 비표준 API라 타입 정의에 없다 */
type ChromePerformance = Performance & {
  memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
};

export type MetricKey = 'heap' | 'dom' | 'listeners' | 'rate';

const SAMPLE_MS = 1000;
/** 실습 도구도 오래 켜 두니 스스로 상한을 지킨다: 5분 치만 보관 */
const HISTORY = 300;
const MB = 1024 * 1024;

const series: Record<MetricKey, number[]> = { heap: [], dom: [], listeners: [], rate: [] };
/** 시나리오 지표의 시계열. 키는 `${시나리오 id}:${지표 이름}` */
const gaugeSeries = new Map<string, number[]>();
const subscribers = new Set<() => void>();
let version = 0;
let lastEmitted = stream.emitted;

function append(list: number[], value: number) {
  list.push(value);
  if (list.length > HISTORY) list.shift();
}

function sample() {
  const memory = (performance as ChromePerformance).memory;
  const push = (key: MetricKey, value: number) => append(series[key], value);
  push('heap', memory ? memory.usedJSHeapSize / MB : NaN);
  push('dom', document.getElementsByTagName('*').length);
  push('listeners', stream.listenerCount('motion'));
  push('rate', ((stream.emitted - lastEmitted) * 1000) / SAMPLE_MS);
  lastEmitted = stream.emitted;
  for (const scenario of scenarios) {
    for (const gauge of scenario.gauges()) {
      const key = `${scenario.id}:${gauge.label}`;
      if (!gaugeSeries.has(key)) gaugeSeries.set(key, []);
      append(gaugeSeries.get(key)!, gauge.value);
    }
  }

  version++;
  for (const notify of subscribers) notify();
}

window.setInterval(sample, SAMPLE_MS);

export const sampler = {
  hasHeapApi: () => (performance as ChromePerformance).memory !== undefined,
  series: (key: MetricKey): readonly number[] => series[key],
  gaugeSeries: (scenarioId: string, label: string): readonly number[] =>
    gaugeSeries.get(`${scenarioId}:${label}`) ?? [],
  getVersion: () => version,
  subscribe(notify: () => void) {
    subscribers.add(notify);
    return () => {
      subscribers.delete(notify);
    };
  },
};
