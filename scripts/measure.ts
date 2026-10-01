/**
 * 누수 재현 검증 스크립트.
 * 프로덕션 빌드를 띄우고 설치된 크롬을 헤드리스로 연 뒤, 시나리오 × 모드마다 일정 시간 돌리면서
 * GC 전/후 JS 힙과 브라우저 프로세스 메모리(macOS footprint)를 기록한다.
 *
 *   pnpm measure                         # 전체 (케이스당 30초)
 *   DURATION=60 pnpm measure             # 케이스당 60초
 *   ONLY=zombie-listener pnpm measure    # 특정 시나리오만
 *   NATURAL=1 pnpm measure               # 전부 강제 GC 없이
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext } from 'playwright';
import { preview } from 'vite';
import type {} from '../src/lab'; // window.__lab 타입만 가져온다

const DURATION_S = Number(process.env.DURATION ?? 30);
const SAMPLE_EVERY_S = 5;
const WARMUP_S = 5;
const ONLY = process.env.ONLY;
/** NATURAL=1이면 모든 케이스를 강제 GC 없이 잰다. 기본은 시나리오의 hiddenByForcedGc를 따른다 */
const ALL_NATURAL = process.env.NATURAL === '1';
const BASELINE_SPEED = 100;
const MB = 1024 * 1024;
const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'results');

type Mode = 'leaky' | 'fixed';
type Case = { scenario: string | null; mode: Mode | null; speed: number; forceGc: boolean };
type ProcessMemory = { renderer: number; gpu: number; total: number };
type Sample = {
  t: number;
  heapBeforeGc: number;
  heapAfterGc: number;
  memBeforeGc: ProcessMemory;
  domNodes: number;
  gauges: { label: string; value: number }[];
};
type CaseResult = Case & { samples: Sample[]; warnings: Record<string, number> };

const UNIT: Record<string, number> = { B: 1, K: 1024, M: MB, G: 1024 * MB };

/**
 * macOS의 memory footprint(활동 상태 보기의 "메모리"와 같은 값)를 pid별로 읽는다.
 * ps의 RSS는 압축된 메모리와 GPU·IOSurface 메모리를 빼고 세서, 메모리 압박이 있거나 영상 프레임을 다룰 때 실제보다 작게 나온다.
 */
function footprintByPid(): Map<number, number> {
  const out = execFileSync('top', ['-l', '1', '-stats', 'pid,mem'], { encoding: 'utf8', maxBuffer: 64 * MB });
  const result = new Map<number, number>();
  for (const line of out.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+([\d.]+)([BKMG])[+-]?$/);
    if (match) result.set(+match[1], Number(match[2]) * UNIT[match[3]]);
  }
  return result;
}

/** Playwright가 띄운 크롬(우리 user-data-dir를 쓰는 프로세스)과 자식 프로세스들의 메모리를 종류별로 합산 */
function browserMemory(userDataDir: string): ProcessMemory {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 64 * MB })
    .split('\n')
    .flatMap((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      return match ? [{ pid: +match[1], ppid: +match[2], command: match[3] }] : [];
    });
  const tree = new Set(rows.filter((r) => r.command.includes(userDataDir)).map((r) => r.pid));
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of rows) {
      if (!tree.has(r.pid) && tree.has(r.ppid)) {
        tree.add(r.pid);
        grew = true;
      }
    }
  }

  const footprints = footprintByPid();
  const memory: ProcessMemory = { renderer: 0, gpu: 0, total: 0 };
  for (const r of rows) {
    if (!tree.has(r.pid)) continue;
    const bytes = footprints.get(r.pid) ?? 0;
    memory.total += bytes;
    if (r.command.includes('--type=renderer')) memory.renderer += bytes;
    if (r.command.includes('--type=gpu-process')) memory.gpu += bytes;
  }
  return memory;
}

async function runCase(context: BrowserContext, url: string, userDataDir: string, c: Case): Promise<CaseResult> {
  const page = await context.newPage();
  const warnings: Record<string, number> = {};
  page.on('console', (msg) => {
    if (msg.type() !== 'warning' && msg.type() !== 'error') return;
    const key = msg.text().slice(0, 90);
    warnings[key] = (warnings[key] ?? 0) + 1;
  });

  await page.goto(url);
  await page.waitForFunction(() => window.__lab !== undefined);
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.evaluate(({ scenario, mode, speed }) => {
    window.__lab.setSpeed(speed);
    if (scenario && mode) window.__lab.setMode(scenario, mode);
  }, c);

  const samples: Sample[] = [];
  const startedAt = Date.now();
  for (let t = 0; t <= DURATION_S; t += SAMPLE_EVERY_S) {
    await sleep(Math.max(0, startedAt + t * 1000 - Date.now()));
    // 강제 GC가 상태를 바꾸기 전에 먼저 읽는다
    const gauges = c.scenario ? await page.evaluate((id) => window.__lab.gauges(id), c.scenario) : [];
    const heapBeforeGc = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    const memBeforeGc = browserMemory(userDataDir);
    if (c.forceGc) await cdp.send('HeapProfiler.collectGarbage');
    const heapAfterGc = c.forceGc ? (await cdp.send('Runtime.getHeapUsage')).usedSize : NaN;
    const { metrics } = await cdp.send('Performance.getMetrics');
    samples.push({
      t,
      heapBeforeGc,
      heapAfterGc,
      memBeforeGc,
      domNodes: metrics.find((m) => m.name === 'Nodes')?.value ?? NaN,
      gauges,
    });
  }

  await cdp.detach();
  await page.close();
  return { ...c, samples, warnings };
}

/** 시작 직후는 버퍼가 차오르는 구간이라 추세 계산에서 뺀다 */
const afterWarmup = (samples: Sample[]) => samples.filter((s) => s.t >= WARMUP_S);

/** 최소제곱 기울기: GC 후 힙이 분당 몇 MB씩 늘었나 */
function slopePerMinute(samples: Sample[]): number {
  const xs = samples.map((s) => s.t / 60);
  const ys = samples.map((s) => s.heapAfterGc / MB);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const num = xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0);
  const den = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
  return den === 0 ? 0 : num / den;
}

const mb = (bytes: number) => `${(bytes / MB).toFixed(1)}`;
const signedMb = (bytes: number) => `${bytes >= 0 ? '+' : ''}${(bytes / MB).toFixed(1)}`;

function summarize(r: CaseResult) {
  const steady = afterWarmup(r.samples);
  const first = steady[0];
  const last = steady.at(-1)!;
  const peak = (pick: (s: Sample) => number) => mb(Math.max(...r.samples.map(pick)));
  const gaugeChanges = last.gauges
    .map((g, i) => `${g.label} ${Math.round(first.gauges[i]?.value ?? 0)}→${Math.round(g.value)}`)
    .join(', ');
  return {
    case: r.scenario ? `${r.scenario} / ${r.mode}` : 'baseline (stream only)',
    speed: `${r.speed}x`,
    GC: r.forceGc ? 'forced' : 'natural',
    'heap after GC': r.forceGc ? `${mb(first.heapAfterGc)} → ${mb(last.heapAfterGc)}` : '-',
    'MB/min': r.forceGc ? slopePerMinute(steady).toFixed(2) : '-',
    'peak heap pre-GC': peak((s) => s.heapBeforeGc),
    'renderer Δ': signedMb(last.memBeforeGc.renderer - first.memBeforeGc.renderer),
    'peak renderer': peak((s) => s.memBeforeGc.renderer),
    'peak GPU': peak((s) => s.memBeforeGc.gpu),
    gauges: gaugeChanges,
  };
}

const server = await preview({ logLevel: 'silent', preview: { port: 4173, strictPort: true } });
const url = server.resolvedUrls?.local[0] ?? 'http://localhost:4173/';
const userDataDir = mkdtempSync(join(tmpdir(), 'memory_leaks-chrome-'));
const context = await chromium.launchPersistentContext(userDataDir, { channel: 'chrome', headless: true });

try {
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.__lab !== undefined);
  const scenarioList = await page.evaluate(() => window.__lab.scenarios());
  await page.close();

  const cases: Case[] = [
    ...(ONLY ? [] : [{ scenario: null, mode: null, speed: BASELINE_SPEED, forceGc: !ALL_NATURAL }]),
    ...scenarioList
      .filter((s) => !ONLY || s.id === ONLY)
      .flatMap((s) =>
        (['leaky', 'fixed'] as const).map((mode) => ({
          scenario: s.id,
          mode,
          speed: s.speed,
          forceGc: !ALL_NATURAL && !s.hiddenByForcedGc,
        })),
      ),
  ];

  console.log(`케이스 ${cases.length}개 × ${DURATION_S}초, ${SAMPLE_EVERY_S}초마다 기록`);
  console.log('GC=forced: 기록 직전 강제 GC (힙 누수용) / GC=natural: 브라우저에 맡김 (GC 타이밍에 가려지는 누수용)\n');
  const results: CaseResult[] = [];
  for (const c of cases) {
    process.stdout.write(`▶ ${c.scenario ?? 'baseline'} ${c.mode ?? ''} (GC ${c.forceGc ? 'forced' : 'natural'}) ... `);
    const result = await runCase(context, url, userDataDir, c);
    results.push(result);
    console.log('done');
  }

  console.log(`\n(MB 단위. 처음 ${WARMUP_S}초는 워밍업이라 변화량·기울기 계산에서 제외)`);
  console.table(results.map(summarize));
  for (const r of results) {
    for (const [text, count] of Object.entries(r.warnings)) {
      console.log(`[console] ${r.scenario ?? 'baseline'} / ${r.mode ?? '-'}: ${count}× ${text}`);
    }
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = join(RESULTS_DIR, `measure-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify({ durationSeconds: DURATION_S, results }, null, 2));
  console.log(`\n원본 기록: ${file}`);
} finally {
  await context.close();
  await server.close();
  rmSync(userDataDir, { recursive: true, force: true });
}
