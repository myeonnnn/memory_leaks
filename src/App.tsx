import { useState, useSyncExternalStore } from 'react';
import { lab } from './lab';
import { sampler } from './metrics/sampler';
import { Sparkline } from './metrics/Sparkline';
import { scenarios } from './scenarios';
import type { LeakMode, Scenario } from './scenarios/types';

const SPEEDS = [1, 10, 100];
const MODES: { value: LeakMode; label: string }[] = [
  { value: 'off', label: '끄기' },
  { value: 'leaky', label: '누수 코드 실행' },
  { value: 'fixed', label: '수정 코드 실행' },
];
const MODE_BADGE: Record<LeakMode, string> = { off: '', leaky: '누수 코드 실행 중', fixed: '수정 코드 실행 중' };

const useLabState = () => useSyncExternalStore(lab.subscribe, lab.getState);
/** 1초마다 들어오는 측정값에 맞춰 다시 그린다 */
const useSamplerTick = () => useSyncExternalStore(sampler.subscribe, sampler.getVersion);

const format = (value: number) =>
  !Number.isFinite(value)
    ? '—'
    : Number.isInteger(value) || Math.abs(value) >= 100
      ? Math.round(value).toLocaleString('ko-KR')
      : value.toFixed(1);

function Explanation({ scenario }: { scenario: Scenario }) {
  return (
    <section className="explain">
      <div className="step">
        <h2>
          <span className="num">1</span> 상황
        </h2>
        <p>{scenario.situation}</p>
      </div>

      <div className="step">
        <h2>
          <span className="num">2</span> 원인
        </h2>
        <div className="code-pair">
          <figure className="code" data-kind="leaky">
            <figcaption>❌ 누수 코드</figcaption>
            <pre>
              <code>{scenario.cause.leaky}</code>
            </pre>
          </figure>
          <figure className="code" data-kind="fixed">
            <figcaption>✅ 수정 코드</figcaption>
            <pre>
              <code>{scenario.cause.fixed}</code>
            </pre>
          </figure>
        </div>
        <p>
          <b>메모리가 새는 이유</b> {scenario.cause.why}
        </p>
      </div>

      <div className="step">
        <h2>
          <span className="num">3</span> 결과
        </h2>
        <ul>
          {scenario.consequences.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ChartCard({ label, unit, values }: { label: string; unit?: string; values: readonly number[] }) {
  return (
    <div className="chart">
      <div className="chart-head">
        <span>{label}</span>
        <strong>
          {format(values.at(-1) ?? NaN)}
          {unit && <small> {unit}</small>}
        </strong>
      </div>
      <Sparkline values={values.slice()} />
      <span className="muted">최근 {values.length}초 동안의 값</span>
    </div>
  );
}

function Monitoring({ scenario }: { scenario: Scenario }) {
  useSamplerTick();
  const { modes, changedAt, speed, streaming } = useLabState();
  const mode = modes[scenario.id];
  const elapsed = changedAt[scenario.id] ? Math.round((Date.now() - changedAt[scenario.id]) / 1000) : 0;
  const gauges = scenario.gauges();
  const { View } = scenario;

  const run = (next: LeakMode) => {
    if (next !== 'off') lab.setSpeed(scenario.speed);
    lab.setMode(scenario.id, next);
  };

  return (
    <section className="monitor" data-mode={mode}>
      <div className="monitor-head">
        <h2>모니터링</h2>
        <div className="segmented" role="group" aria-label="실행할 코드">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-pressed={mode === m.value}
              data-variant={m.value}
              onClick={() => run(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="muted">
          {mode === 'off' ? '버튼을 눌러서 누수 코드나 수정 코드를 실행해 보세요.' : `${MODE_BADGE[mode]} · ${elapsed}초 경과 · ${speed}배속`}
        </span>
      </div>

      <div className="watch">
        <b>확인할 항목</b>
        <ul>
          {scenario.watch.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      <div className="charts">
        {gauges
          .filter((g) => g.chart !== false)
          .map((g) => (
            <ChartCard
              key={g.label}
              label={g.label}
              unit={g.unit}
              values={sampler.gaugeSeries(scenario.id, g.label)}
            />
          ))}
        <ChartCard label="JS 힙" unit="MB" values={sampler.series('heap')} />
      </div>

      <dl className="stats">
        {gauges
          .filter((g) => g.chart === false)
          .map((g) => (
            <div key={g.label}>
              <dt>{g.label}</dt>
              <dd>{format(g.value)}</dd>
            </div>
          ))}
        <div>
          <dt>처리량</dt>
          <dd>{format(sampler.series('rate').at(-1) ?? NaN)} 건/초</dd>
        </div>
      </dl>

      {View && mode !== 'off' && (
        <div className="view">
          <span className="muted">실행 중인 화면</span>
          <View mode={mode} />
        </div>
      )}

      <div className="stream">
        <span className="muted">데이터 스트림 (초당 60번)</span>
        <button type="button" onClick={() => lab.setStreaming(!streaming)}>
          {streaming ? '정지' : '시작'}
        </button>
        <div className="segmented" role="group" aria-label="스트림 배속">
          {SPEEDS.map((s) => (
            <button key={s} type="button" aria-pressed={speed === s} onClick={() => lab.setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <span className="muted">배속을 높이면, 페이지를 오래 켜 두었을 때 생기는 상황을 몇 분 안에 확인할 수 있어요.</span>
      </div>

      <details>
        <summary>크롬 DevTools로 직접 찾아보기</summary>
        <ol>
          {scenario.howToFind.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </details>
      {!sampler.hasHeapApi() && <p className="warn">JS 힙 그래프는 크롬에서만 표시돼요.</p>}
    </section>
  );
}

/** 다른 탭을 보고 있어도, 실행 중인 시나리오의 화면은 계속 동작해야 누수가 이어진다 */
function BackgroundViews({ selectedId }: { selectedId: string }) {
  const { modes } = useLabState();
  return (
    <div hidden>
      {scenarios.map((s) => {
        const mode = modes[s.id];
        const { View } = s;
        if (!View || mode === 'off' || s.id === selectedId) return null;
        return <View key={s.id} mode={mode} />;
      })}
    </div>
  );
}

export function App() {
  const { modes } = useLabState();
  const [selectedId, setSelectedId] = useState(scenarios[0].id);
  const scenario = scenarios.find((s) => s.id === selectedId)!;

  return (
    <main className="page">
      <header className="page-head">
        <h1>memory_leaks</h1>
        <p className="muted">
          오래 켜 두는 웹앱에서 자주 발생하는 메모리 누수 네 가지 유형을 직접 재현하고, 그 결과를 그래프로 확인하는
          페이지예요.
        </p>
      </header>

      <nav className="tabs" role="tablist">
        {scenarios.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={s.id === selectedId}
            onClick={() => setSelectedId(s.id)}
          >
            {i + 1}. {s.title}
            {modes[s.id] !== 'off' && (
              <span className="badge" data-mode={modes[s.id]}>
                {MODE_BADGE[modes[s.id]]}
              </span>
            )}
          </button>
        ))}
      </nav>

      <Explanation scenario={scenario} />
      <Monitoring scenario={scenario} />
      <BackgroundViews selectedId={selectedId} />
    </main>
  );
}
