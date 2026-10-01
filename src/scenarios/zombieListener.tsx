import { useEffect, useState } from 'react';
import { stream, type MotionSample } from '../sim/sensorStream';
import type { ActiveMode, Scenario } from './types';

/** 컴포넌트 하나가 차트용으로 보관하는 최근 값 수 (60번 × 10초) */
const PANEL_WINDOW = 600;
/** 화면 열고 닫기를 초당 10번으로 가속한다 */
const REMOUNT_MS = 100;

let effectRuns = 0;

const toValue = (s: MotionSample) => Math.atan2(s.ax, s.az) * (180 / Math.PI);

/** 실시간 값 패널. 마운트될 때 스트림을 구독하고 자기 차트용 버퍼를 가진다 */
function ValuePanel({ mode }: { mode: ActiveMode }) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    effectRuns++;
    const points: { t: number; value: number }[] = new Array(PANEL_WINDOW);
    let next = 0;

    const onData = (sample: MotionSample) => {
      const point = { t: sample.t, value: toValue(sample) };
      points[next] = point;
      next = (next + 1) % PANEL_WINDOW;
      setValue(point.value);
    };
    stream.on('motion', onData);

    if (mode === 'fixed') {
      // ✅ 화면을 떠날 때 구독을 해제한다
      return () => stream.off('motion', onData);
    }
    // ❌ 정리 함수를 돌려주지 않는다.
    //    컴포넌트가 사라져도 stream이 onData를 붙잡고 있어서, onData가 붙잡은 points까지 살아남아 계속 일한다.
  }, [mode]);

  return <div className="value-panel">현재 값 {value.toFixed(1)}</div>;
}

function RemountingPanel({ mode }: { mode: ActiveMode }) {
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setGeneration((g) => g + 1), REMOUNT_MS);
    return () => window.clearInterval(id);
  }, []);

  // key가 바뀔 때마다 이전 패널은 언마운트되고 새 패널이 마운트된다 = 화면 열고 닫기
  return <ValuePanel key={generation} mode={mode} />;
}

export const zombieListener: Scenario = {
  id: 'zombie-listener',
  title: '해제되지 않은 리스너: 정리하지 않은 구독',
  situation:
    '컴포넌트가 화면에 나타날 때 데이터 구독을 시작해요. 사용자는 이 화면을 여러 번 열고 닫아요. 이 실습에서는 화면을 1초에 10번 열고 닫아요.',
  cause: {
    leaky: `function ValuePanel() {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const points = new Array(600); // 이 컴포넌트의 차트 버퍼
    const onData = (s) => {
      points[i++ % 600] = toValue(s);
      setValue(toValue(s));
    };
    stream.on('data', onData);
    // return이 없다 → 컴포넌트가 사라져도 구독이 그대로 남는다
  }, []);
}`,
    fixed: `function ValuePanel() {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const points = new Array(600);
    const onData = (s) => {
      points[i++ % 600] = toValue(s);
      setValue(toValue(s));
    };
    stream.on('data', onData);
    return () => stream.off('data', onData); // 사라질 때 구독 해제
  }, []);
}`,
    why: 'stream 객체는 앱 전체에서 하나만 존재하고, 앱이 켜져 있는 동안 계속 메모리에 남아 있어요. stream은 onData 함수를 참조하고, onData 함수는 points 배열을 참조해요. 그래서 컴포넌트가 화면에서 사라진 뒤에도 onData와 points는 메모리에서 지워지지 않고, 데이터가 들어올 때마다 onData가 계속 실행돼요. 이때 사라진 컴포넌트의 setValue도 계속 호출되어, React 내부에는 처리되지 않는 업데이트가 계속 쌓여요.',
  },
  consequences: [
    '화면을 한 번 열고 닫을 때마다 해제되지 않은 리스너가 하나씩 남아요. 이런 리스너를 흔히 "좀비 리스너"라고 불러요. 좀비 리스너는 각자의 차트 버퍼를 계속 참조해요. 게다가 React 내부에 처리되지 않는 업데이트가 쌓이기 때문에, 좀비 리스너 하나가 차지하는 메모리도 시간이 지날수록 커져요.',
    '좀비 리스너도 데이터가 들어올 때마다 실행돼요. 좀비 리스너가 200개라면, 쓸모없는 함수 호출이 초당 12,000번(60번 × 200개) 추가로 발생해요.',
    '메모리 사용량과 CPU 사용량이 함께 늘어나기 때문에, 앱을 오래 사용할수록 화면이 느려져요.',
    '이 실습에서 화면을 1초에 10번 열고 닫았을 때는 30초 만에 리스너가 300개로 늘었고, 메모리는 1분에 약 42MB씩 늘었어요. 측정 시간이 길어질수록 메모리가 늘어나는 속도도 빨라져요.',
  ],
  watch: [
    '"리스너 수" 그래프: 누수 코드를 실행하면 리스너 수가 계속 늘어나고, 수정 코드를 실행하면 1개에서 변하지 않아요.',
    '"JS 힙" 그래프: 좀비 리스너가 늘어날수록 JS 힙도 함께 늘어나요.',
    '"끄기"를 눌러도 리스너 수는 줄어들지 않아요. 이미 남아 있는 좀비 리스너를 없애려면 페이지를 새로고침해야 해요.',
  ],
  howToFind: [
    'Performance monitor의 "JS event listeners" 지표는 DOM 요소나 window처럼 브라우저가 제공하는 객체에 등록된 리스너만 세요. 따라서 소켓이나 직접 만든 이벤트 객체에 등록된 리스너가 누수되더라도, 이 지표에는 나타나지 않아요.',
    'Heap snapshot을 두 번 찍어 Comparison 보기로 비교하고, Class filter에 Function을 입력한 뒤 항목을 펼쳐서 onData를 찾아요. 두 스냅샷 사이에 늘어난 onData의 개수는 그동안 컴포넌트가 마운트된 횟수와 거의 같아요.',
    'onData 클로저의 Retainers 패널에서 참조 경로(stream → listeners → motion → [n] → onData)를 확인해요. 같은 경로를 통해 points 배열도 함께 참조되고 있다는 것을 확인할 수 있어요.',
    '개발 서버에서는 React의 StrictMode가 effect를 두 번 실행하기 때문에, 누수 코드를 실행하면 마운트 한 번마다 리스너가 2개씩 늘어나요. 프로덕션 빌드에서는 1개씩 늘어나요.',
  ],
  speed: 1,
  View: RemountingPanel,
  gauges: () => [
    { label: 'effect 실행 횟수', value: effectRuns, chart: false },
    { label: '리스너 수', value: stream.listenerCount('motion') },
  ],
};
