import type { ActiveMode, Scenario } from './types';

const VALUES_PER_SNAPSHOT = 10_000;
/** 데이터 묶음을 초당 10번 교체한다 */
const REFRESH_MS = 100;

/** 한 번 불러온 데이터 묶음. 클래스로 만들어 두면 힙 스냅샷과 queryObjects()에서 이름으로 찾을 수 있다 */
class ValueSnapshot {
  constructor(
    readonly values: number[],
    readonly describe: () => string,
  ) {}
}

let current: ActiveMode | null = null;
let timer: number | undefined;
let latest: ValueSnapshot | null = null;
let created = 0;
let collected = 0;
let changes = 0;

const gcWatch = new FinalizationRegistry<void>(() => {
  collected++;
});

/** 두 묶음의 값이 하나라도 다른지 확인한다 */
function hasChanged(previous: ValueSnapshot | null, values: number[]) {
  return previous !== null && values.some((v, i) => v !== previous.values[i]);
}

function refreshLeaky(values: number[]) {
  const previous = latest;
  // 이전 묶음과 값이 달라졌는지 확인한다. some에 넘긴 화살표 함수가 previous를 사용한다
  if (previous !== null && values.some((v, i) => v !== previous.values[i])) changes++;
  // ❌ describe는 previous를 쓰지 않는다. 하지만 위 화살표 함수와 같은 함수 안에서 만들어져서
  //    변수 상자(Context)를 공유하고, 그 상자를 통해 previous를 계속 참조한다.
  //    그래서 latest → describe → previous → describe → … 로 모든 과거 묶음이 이어진다
  latest = new ValueSnapshot(values, () => `${values.length}개 값`);
}

function refreshFixed(values: number[]) {
  // ✅ 비교는 별도 함수에서 한다. 그러면 이 함수 안에는 previous를 사용하는 클로저가 없다
  if (hasChanged(latest, values)) changes++;
  latest = new ValueSnapshot(values, () => `${values.length}개 값`);
}

function refresh() {
  const values = Array.from({ length: VALUES_PER_SNAPSHOT }, Math.random);
  if (current === 'leaky') refreshLeaky(values);
  else refreshFixed(values);
  gcWatch.register(latest!, undefined);
  created++;
}

export const closureContext: Scenario = {
  id: 'closure-context',
  title: '보이지 않는 참조 데이터: 클로저가 공유하는 변수',
  situation:
    '데이터 묶음을 주기적으로 새로 받아서, 가장 최신 묶음 하나만 latest 변수에 보관해요. 새 묶음을 받을 때마다 이전 묶음과 값이 달라졌는지 비교해요. 이 실습에서는 값 10,000개짜리 묶음을 1초에 10번 받아요.',
  cause: {
    leaky: `let latest = null; // 최신 묶음 하나만 보관한다

function refresh(values) {
  const previous = latest;

  // 화살표 함수 ①: previous를 사용한다 (비교에 한 번 쓰고 버린다)
  if (previous && values.some((v, i) => v !== previous.values[i])) {
    render();
  }

  // 화살표 함수 ②: values만 사용한다 (latest에 저장되어 계속 남는다)
  latest = { values, describe: () => \`\${values.length}개 값\` };
}`,
    fixed: `// 비교를 별도 함수로 분리한다
function hasChanged(previous, values) {
  return previous && values.some((v, i) => v !== previous.values[i]);
}

function refresh(values) {
  if (hasChanged(latest, values)) render();

  // 이제 refresh 안에는 previous를 사용하는 화살표 함수가 없다
  latest = { values, describe: () => \`\${values.length}개 값\` };
}`,
    why: '자바스크립트 엔진(V8)은 refresh가 한 번 실행될 때마다 "변수 상자(Context)"를 하나 만들고, 그 실행 안에서 만들어진 화살표 함수들이 사용하는 바깥 변수를 모두 이 상자에 넣어요. 화살표 함수 ①은 previous를, ②는 values를 사용하므로, 상자에는 previous와 values가 함께 들어가요. 그리고 ①과 ②는 이 상자 하나를 함께 참조해요. ①은 비교가 끝나면 버려지지만, ②(describe)는 latest에 저장되어 계속 남아요. 그래서 describe가 남아 있는 동안 상자도 남고, 상자 안의 previous(이전 묶음)도 남아요. 이전 묶음의 describe도 같은 방식으로 그 이전 묶음을 참조하므로, 지금까지 만든 모든 묶음이 사슬처럼 이어져요.',
  },
  consequences: [
    '코드에서 참조하는 묶음은 latest 하나뿐인데, 메모리에는 지금까지 만든 모든 묶음이 남아 있어요.',
    '묶음 하나가 약 80KB이므로, 1초에 10번 교체하면 메모리가 1분에 약 48MB씩 늘어나요. 이 실습에서는 30초 동안 묶음 300개가 모두 남았고, 메모리는 1분에 약 46MB씩 늘었어요.',
    '코드를 읽어서는 describe가 previous를 참조한다는 사실을 알 수 없어요. 코드 리뷰에서 발견하기 가장 어려운 누수 중 하나예요.',
  ],
  watch: [
    '"메모리에 남은 묶음" 그래프: 누수 코드를 실행하면 끝없이 늘어나고, 수정 코드를 실행하면 GC가 실행될 때마다 적은 수로 돌아와요.',
    '"JS 힙" 그래프: 누수 코드를 실행하면 계속 올라가요.',
  ],
  howToFind: [
    '실제 코드는 묶음을 ValueSnapshot 클래스로 만들어요. ValueSnapshot은 모듈 안에 선언되어 있어서 콘솔에서 바로 참조할 수 없어요. 그래서 Sources 탭에서 closureContext 파일의 refresh 함수에 중단점을 걸고, 실행이 멈춘 상태에서 콘솔에 queryObjects(ValueSnapshot)을 입력해요. 코드에서 보관하는 묶음은 하나뿐인데, 결과에는 수백 개가 표시돼요.',
    'Memory 탭에서 Heap snapshot을 찍고, Class filter에 ValueSnapshot을 입력해요. 오래된 묶음 하나를 선택해요.',
    'Retainers 패널에서 "previous in system / Context → context in function () → describe in ValueSnapshot → previous in system / Context → …"처럼 같은 경로가 반복되는 사슬을 확인해요.',
    '사슬에서 describe(이름 없는 화살표 함수)가 previous를 참조하는 연결은 코드에 없는 연결이에요. 이 연결은 같은 refresh 실행 안에서 만들어진 some의 화살표 함수 때문에 생긴다는 것을 확인해요.',
  ],
  speed: 1,
  start(mode) {
    current = mode;
    timer = window.setInterval(refresh, REFRESH_MS);
  },
  stop() {
    window.clearInterval(timer);
    timer = undefined;
    latest = null;
    current = null;
  },
  gauges: () => [
    { label: '만든 묶음', value: created, chart: false },
    { label: '값 변경 감지', value: changes, chart: false },
    { label: '메모리에 남은 묶음', value: created - collected },
  ],
};
