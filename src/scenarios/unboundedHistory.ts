import { stream, type MotionSample } from '../sim/sensorStream';
import type { ActiveMode, Scenario } from './types';

const WINDOW_SECONDS = 60;
const CAPACITY = WINDOW_SECONDS * 60; // 60Hz × 60초

/** 수정 버전에서 쓰는 고정 크기 버퍼. 가득 차면 가장 오래된 값을 덮어쓴다 */
class RingBuffer<T> {
  private readonly items: (T | undefined)[];
  private next = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    this.items = new Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(item: T): void {
    this.items[this.next] = item;
    this.next = (this.next + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  clear(): void {
    this.items.fill(undefined);
    this.next = 0;
    this.count = 0;
  }
}

let leakyHistory: MotionSample[] = [];
const ring = new RingBuffer<MotionSample>(CAPACITY);
let current: ActiveMode | null = null;

function onMotion(sample: MotionSample) {
  if (current === 'leaky') {
    // ❌ "최근 60초 차트용"이라며 쌓기만 하고, 오래된 값을 지우는 코드가 없다
    leakyHistory.push(sample);
  } else {
    // ✅ 상한이 있는 버퍼: 60초 치를 넘으면 오래된 값부터 덮어쓴다
    ring.push(sample);
  }
}

export const unboundedHistory: Scenario = {
  id: 'unbounded-history',
  title: '제한 없이 쌓이는 데이터: 계속 쌓이는 배열',
  situation:
    '초당 60번 들어오는 데이터를 "최근 60초" 차트로 그려요. 사용자는 페이지를 새로고침하지 않고 오래 켜 둬요.',
  cause: {
    leaky: `const history: Sample[] = [];

stream.on('data', (sample) => {
  history.push(sample); // 추가만 하고 지우지 않는다
});`,
    fixed: `const history = new RingBuffer<Sample>(3600); // 60초 × 60번

stream.on('data', (sample) => {
  history.push(sample); // 3600개가 차면 가장 오래된 값을 덮어쓴다
});`,
    why: '차트는 최근 60초에 해당하는 값만 그리지만, 배열에는 페이지를 연 순간부터 들어온 값이 전부 남아 있어요. 배열이 이 값들을 계속 참조하고 있기 때문에, GC는 그중 어떤 값도 메모리에서 지울 수 없어요.',
  },
  consequences: [
    '값 하나가 차지하는 메모리는 약 134바이트예요(실측값). 따라서 1시간이 지나면 약 21만 개(약 28MB), 24시간이 지나면 약 518만 개(약 660MB)가 쌓여요.',
    '메모리 사용량이 커질수록 GC가 한 번 실행될 때 GC가 해야 할 일도 늘어나기 때문에, 화면이 잠깐씩 멈출 수 있어요.',
    '메모리 사용량이 결국 탭의 한도에 도달하면, 크롬은 탭을 종료하고 "앗, 이런!" 오류 화면을 표시해요.',
    '이 실습에서 100배속으로 실행했을 때는 메모리가 1분에 약 45MB씩 늘었어요.',
  ],
  watch: [
    '"보관 중인 값" 그래프: 누수 코드를 실행하면 값의 개수가 끝없이 늘어나고, 수정 코드를 실행하면 3,600개에서 더 늘어나지 않아요.',
    '"JS 힙" 그래프: 누수 코드를 실행하면 그래프가 계속 올라가요.',
  ],
  howToFind: [
    'DevTools의 Performance monitor를 열고, JS heap size 그래프에서 GC 직후의 가장 낮은 값이 점점 올라가는지 확인해요.',
    'Memory 탭에서 Heap snapshot을 10초 간격으로 두 번 찍은 뒤, 두 번째 스냅샷을 Comparison 보기로 열어요.',
    '# Delta 열을 기준으로 정렬하면, {t, ax, ay, az, gx, gy, gz} 항목이 가장 많이 늘어나 있어요. DevTools는 일반 객체를 속성 이름으로 묶어서 보여 줘요.',
    '그 객체를 선택하고 Retainers 패널에서 참조 경로를 따라가면, 이 객체를 참조하는 leakyHistory 배열을 찾을 수 있어요.',
  ],
  speed: 100,
  start(mode) {
    current = mode;
    stream.on('motion', onMotion);
  },
  stop() {
    stream.off('motion', onMotion);
    current = null;
    leakyHistory = [];
    ring.clear();
  },
  gauges: () => [
    { label: '보관 중인 값', value: current === 'leaky' ? leakyHistory.length : ring.size },
  ],
};
