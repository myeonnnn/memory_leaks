import { useEffect, useRef } from 'react';
import type { ActiveMode, Scenario } from './types';

/** 툴팁을 초당 20개 띄운다 */
const CREATE_EVERY_MS = 50;
const VISIBLE_MS = 1000;
/** 툴팁 하나가 상세 보기용으로 들고 있는 값 수 */
const DETAIL_VALUES = 2000;

let current: ActiveMode | null = null;
let timer: number | undefined;
let host: HTMLElement | null = null;
/** "모두 닫기" 기능을 위해 띄운 툴팁을 보관하는 목록 */
let opened: HTMLElement[] = [];
let created = 0;
let lastOpenedDetail = 0;

function hideTooltip(el: HTMLElement) {
  el.remove(); // 화면에서 제거한다
  if (current === 'fixed') {
    // ✅ 목록에서도 제거한다
    const index = opened.indexOf(el);
    if (index !== -1) opened.splice(index, 1);
  }
  // ❌ leaky: 목록에서는 제거하지 않는다. 화면에서는 사라졌지만 목록이 계속 참조한다
}

function showTooltip() {
  if (!host) return;
  const detail = Array.from({ length: DETAIL_VALUES }, Math.random);
  const el = document.createElement('div');
  el.className = 'tooltip';
  el.textContent = `알림 ${created} · 값 ${detail.length}개`;
  el.addEventListener('click', function openDetail() {
    lastOpenedDetail = detail.length;
  });
  host.append(el);
  opened.push(el);
  created++;
  window.setTimeout(() => hideTooltip(el), VISIBLE_MS);
}

function TooltipHost() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    host = ref.current;
    return () => {
      host = null;
    };
  }, []);

  return <div ref={ref} className="tooltip-host" data-last-opened={lastOpenedDetail} />;
}

export const detachedDom: Scenario = {
  id: 'detached-dom',
  title: '보이지 않는 참조 데이터: 화면에서 제거한 DOM',
  situation:
    '새 알림이 올 때마다 툴팁을 띄우고, 1초 뒤에 화면에서 제거해요. "모두 닫기" 기능을 만들기 위해, 띄운 툴팁을 목록(배열)에 보관해요. 이 실습에서는 툴팁을 1초에 20개씩 띄워요.',
  cause: {
    leaky: `const opened: HTMLElement[] = []; // "모두 닫기"용 목록

function showTooltip(detail) {
  const el = createTooltip(detail);
  document.body.append(el);
  opened.push(el);
  setTimeout(() => {
    el.remove(); // 화면에서만 제거한다
  }, 1000);
}`,
    fixed: `const opened = new Set<HTMLElement>();

function showTooltip(detail) {
  const el = createTooltip(detail);
  document.body.append(el);
  opened.add(el);
  setTimeout(() => {
    el.remove();
    opened.delete(el); // 목록에서도 제거한다
  }, 1000);
}`,
    why: 'el.remove()는 요소를 화면(문서)에서만 떼어 내요. 목록이 그 요소를 계속 참조하고 있으므로, GC는 요소를 정리할 수 없어요. 요소에 등록된 클릭 리스너와 그 리스너가 참조하는 detail 배열도 함께 남아요. 이렇게 화면에서는 제거됐지만 메모리에는 남은 DOM을 "Detached DOM"이라고 불러요. 원인은 "제한 없이 쌓이는 데이터"와 같지만, 화면에서는 보이지 않기 때문에 알아채기 어려워요.',
  },
  consequences: [
    '툴팁 하나가 요소, 리스너, 상세 값 2,000개를 함께 참조하므로, 1초에 20개씩 띄우면 메모리가 계속 늘어나요. 이 실습에서는 30초 동안 툴팁 579개가 메모리에 남았고, 메모리는 1분에 약 19MB씩 늘었어요.',
    '화면에 표시된 툴팁은 항상 20개 정도라서, 화면만 보면 아무 문제가 없어 보여요.',
    '문서에 붙어 있는 요소의 수는 거의 변하지 않아요(실측: 115개에서 116개). 반면 DevTools의 Performance monitor에 표시되는 DOM Nodes는 화면에서 제거된 노드도 포함하기 때문에 계속 늘어나요(실측: 423개에서 1,425개).',
  ],
  watch: [
    '"화면에서 제거됐지만 남은 툴팁" 그래프: 누수 코드를 실행하면 계속 늘어나고, 수정 코드를 실행하면 0에 머물러요.',
    '"문서의 DOM 노드" 그래프: 두 경우 모두 거의 변하지 않아요. 화면에 붙어 있는 노드만 세기 때문이에요.',
    '"JS 힙" 그래프: 누수 코드를 실행하면 계속 올라가요.',
  ],
  howToFind: [
    'Performance monitor의 DOM Nodes 값이 계속 늘어나는지 확인해요. 화면에 보이는 툴팁 수는 그대로인데 이 값이 늘어난다면, 화면에서 제거된 DOM이 메모리에 남아 있다는 뜻이에요.',
    'Memory 탭에서 Detached elements 프로파일을 기록하면, 화면에서 제거됐지만 메모리에 남은 요소의 목록과 개수를 바로 확인할 수 있어요.',
    '어떤 코드가 요소를 참조하는지 찾으려면 Heap snapshot을 찍고, Class filter에 Detached를 입력해요. "Detached <div>" 항목의 개수가 계속 늘어나는지 확인해요.',
    'Detached <div> 하나를 선택하고 Retainers 패널을 확인해요. "[n] in Array → opened"처럼 목록 배열이 요소를 참조하는 경로가 표시돼요.',
    '같은 요소를 펼쳐 보면 클릭 리스너(openDetail)와 detail 배열도 함께 남아 있는 것을 확인할 수 있어요.',
  ],
  speed: 1,
  start(mode) {
    current = mode;
    timer = window.setInterval(showTooltip, CREATE_EVERY_MS);
  },
  stop() {
    window.clearInterval(timer);
    timer = undefined;
    for (const el of opened) el.remove();
    opened = [];
    current = null;
  },
  View: TooltipHost,
  gauges: () => {
    const connected = opened.filter((el) => el.isConnected).length;
    return [
      { label: '화면에 표시 중인 툴팁', value: connected, chart: false },
      { label: '만든 툴팁', value: created, chart: false },
      { label: '화면에서 제거됐지만 남은 툴팁', value: opened.length - connected },
      { label: '문서의 DOM 노드', value: document.getElementsByTagName('*').length },
    ];
  },
};
