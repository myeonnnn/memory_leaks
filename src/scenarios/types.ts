import type { ComponentType } from 'react';

export type LeakMode = 'off' | 'leaky' | 'fixed';
export type ActiveMode = Exclude<LeakMode, 'off'>;

/** chart가 false면 그래프 대신 숫자로만 보여준다 */
export type Gauge = { label: string; value: number; unit?: string; chart?: boolean };

export interface Scenario {
  id: string;
  title: string;
  /** 실제 앱에서 이런 코드가 생기는 상황 */
  situation: string;
  /** 누수 코드와 수정 코드, 그리고 왜 새는지 */
  cause: { leaky: string; fixed: string; why: string };
  /** 그대로 두면 벌어지는 일 (숫자로) */
  consequences: string[];
  /** 모니터링에서 무엇을 보면 되는지 */
  watch: string[];
  /** DevTools에서 직접 찾아가는 순서 */
  howToFind: string[];
  /** 누수가 잘 보이는 스트림 배속. 측정 스크립트도 이 값을 쓴다 */
  speed: number;
  /** 측정 중에 강제 GC를 하면 가려지는 누수인가. true면 측정 스크립트가 GC를 브라우저에 맡긴다 */
  hiddenByForcedGc?: boolean;
  start?(mode: ActiveMode): void;
  stop?(): void;
  /** 켜져 있는 동안 렌더링할 화면 */
  View?: ComponentType<{ mode: ActiveMode }>;
  /** 1초마다 읽어 가는 시나리오 고유 지표 */
  gauges(): Gauge[];
}
