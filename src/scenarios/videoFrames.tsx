import { useEffect, useRef } from 'react';
import type { ActiveMode, Scenario } from './types';

const WIDTH = 640;
const HEIGHT = 360;
const FPS = 15;
/** 되감기용으로 붙잡아 두는 최근 프레임 수 (3초) */
const REPLAY_FRAMES = FPS * 3;
const FRAME_BYTES = WIDTH * HEIGHT * 4;
const MB = 1024 * 1024;

let current: ActiveMode | null = null;
let timer: number | undefined;
let source: OffscreenCanvas | null = null;
let recent: VideoFrame[] = [];

let created = 0;
let closed = 0;
let discardedOpen = 0;
let collectedByGc = 0;

/** 닫지 않고 버린 프레임을 GC가 언제 대신 치우는지 관찰한다. 등록만으로는 프레임을 붙잡지 않는다 */
const gcWatch = new FinalizationRegistry<void>(() => {
  collectedByGc++;
});

/** 카메라 대신 움직이는 테스트 화면을 그린다 */
function drawTestPattern(ctx: OffscreenCanvasRenderingContext2D, frameIndex: number) {
  const x = (frameIndex * 8) % WIDTH;
  ctx.fillStyle = '#0b2540';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#1f6fb2';
  ctx.fillRect(0, HEIGHT * 0.6, WIDTH, HEIGHT * 0.4);
  ctx.fillStyle = '#f2b134';
  ctx.beginPath();
  ctx.arc(x, HEIGHT * 0.55, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '20px monospace';
  ctx.fillText(`frame ${frameIndex}`, 16, 32);
}

function captureFrame(ctx: OffscreenCanvasRenderingContext2D) {
  drawTestPattern(ctx, created);
  const frame = new VideoFrame(source!, { timestamp: created * Math.round(1_000_000 / FPS) });
  created++;
  recent.push(frame);

  if (recent.length > REPLAY_FRAMES) {
    const oldest = recent.shift()!;
    if (current === 'fixed') {
      // ✅ 버퍼에서 뺄 때 픽셀 메모리를 즉시 돌려준다
      oldest.close();
      closed++;
    } else {
      // ❌ 배열에서만 빼고 close()를 안 한다. 픽셀 메모리는 GC가 언젠가 치울 때까지 남는다
      discardedOpen++;
      gcWatch.register(oldest, undefined);
    }
  }
}

function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = canvasRef.current!.getContext('2d')!;
    let raf = 0;
    const draw = () => {
      const latest = recent.at(-1);
      if (latest) ctx.drawImage(latest, 0, 0, ctx.canvas.width, ctx.canvas.height);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} width={320} height={180} className="preview" />;
}

export const videoFrames: Scenario = {
  id: 'video-frames',
  title: '정리하지 않은 브라우저 자원: 닫지 않은 영상 프레임',
  situation:
    '영상을 재생하면서, 되감기 기능을 위해 최근 3초 분량(45프레임)의 프레임을 배열에 보관해요. 새 프레임이 들어오면 가장 오래된 프레임을 배열에서 제거해요.',
  cause: {
    leaky: `recent.push(frame);          // 되감기용 최근 3초
if (recent.length > 45) {
  recent.shift();            // 배열에서만 뺀다
}`,
    fixed: `recent.push(frame);
if (recent.length > 45) {
  recent.shift().close();    // 픽셀 메모리를 바로 반납한다
}`,
    why: 'VideoFrame의 자바스크립트 객체는 크기가 작지만, 실제 픽셀 데이터(이 실습에서는 프레임당 약 0.9MB)는 JS 힙 바깥에 저장돼요. 이 실습처럼 GPU로 그린 캔버스에서 만든 프레임은 GPU 프로세스의 메모리에 저장돼요. close()를 호출하지 않으면, GC가 자바스크립트 객체를 정리할 때까지 픽셀 데이터가 메모리에 남아 있어요. 그런데 자바스크립트 힙에서는 이 객체들이 작은 크기로만 계산되기 때문에, GC가 빨리 실행되지 않아요.',
  },
  consequences: [
    '프레임 하나가 약 0.9MB이고 초당 15장이 만들어지므로, 반납되지 않은 메모리가 초당 약 13MB씩 쌓여요.',
    'GC가 실행되면 쌓여 있던 프레임이 한꺼번에 정리되기 때문에, GPU 메모리 사용량은 수백 MB 범위에서 올라갔다가 급격히 떨어지기를 반복해요. 실측 결과, 누수 코드를 실행했을 때 GPU 메모리는 최대 547MB까지 올라갔고, 수정 코드를 실행했을 때는 242MB였어요.',
    '1080p 해상도에 초당 30프레임인 영상이라면, 프레임 하나가 약 3MB(RGBA 형식이면 약 8MB)이므로 초당 약 90MB가 쌓여요. 또한 영상 디코더와 카메라는 한 번에 다룰 수 있는 프레임 수가 정해져 있어서, 프레임을 닫지 않으면 새 프레임을 만들지 못하고 영상이 멈출 수 있어요.',
    '이 동안 JS 힙은 약 3.5MB로 거의 변하지 않아요. 그래서 힙 그래프만 보면 문제가 없는 것처럼 보여요.',
  ],
  watch: [
    '"GC 대기 중(추정)" 그래프: 누수 코드를 실행하면 값이 쌓였다가 GC가 실행될 때 급격히 떨어지는 톱니 모양이 나타나고, 수정 코드를 실행하면 항상 0이에요.',
    '"JS 힙" 그래프: 두 경우 모두 거의 변하지 않아요. 따라서 힙만 확인해서는 이 누수를 찾을 수 없어요.',
    '실제 메모리 사용량은 크롬 메뉴 → 도구 더보기 → 작업 관리자를 열고, "GPU 프로세스" 행에서 확인할 수 있어요.',
  ],
  howToFind: [
    '먼저 JS heap size가 거의 변하지 않는다는 것을 확인해요. 힙 그래프만 확인하면 이 누수를 놓치게 돼요.',
    '크롬 메뉴 → 도구 더보기 → 작업 관리자를 열고, "GPU 프로세스" 행의 메모리가 올라갔다가 떨어지기를 반복하는지 확인해요. 이 탭에 해당하는 행은 거의 변하지 않아요.',
    '콘솔에 "A VideoFrame was garbage collected without being closed" 오류 메시지가 표시되는지 확인해요. 이 메시지는 경고가 아니라 오류 수준으로 기록되기 때문에, 콘솔 필터에서 Errors를 꺼 두면 보이지 않아요.',
    'Heap snapshot에서 VideoFrame을 검색하면 객체의 개수는 확인할 수 있지만, 크기는 작게 표시돼요. 또한 스냅샷을 찍는 시점에 GC가 실행되기 때문에, 대부분의 프레임이 이미 정리되어 있을 수도 있어요.',
  ],
  speed: 1,
  hiddenByForcedGc: true,
  start(mode) {
    current = mode;
    source = new OffscreenCanvas(WIDTH, HEIGHT);
    const ctx = source.getContext('2d')!;
    timer = window.setInterval(() => captureFrame(ctx), 1000 / FPS);
  },
  stop() {
    window.clearInterval(timer);
    timer = undefined;
    for (const frame of recent) frame.close();
    closed += recent.length;
    recent = [];
    source = null;
    current = null;
  },
  View: Preview,
  gauges: () => {
    const pending = discardedOpen - collectedByGc;
    return [
      { label: '만든 프레임', value: created, chart: false },
      { label: 'close() 한 프레임', value: closed, chart: false },
      { label: '닫지 않고 버린 프레임', value: discardedOpen },
      { label: 'GC가 정리한 프레임', value: collectedByGc, chart: false },
      { label: 'GC 대기 중 (추정)', value: (pending * FRAME_BYTES) / MB, unit: 'MB' },
    ];
  },
};
