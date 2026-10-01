# memory_leaks

메모리 누수는 더 이상 쓰지 않는 데이터가 메모리에서 지워지지 않고 남아서, 페이지를 오래 켜 둘수록 메모리 사용량이 계속 늘어나는 현상이다.

자바스크립트에서는 메모리를 직접 지울 필요가 없다. 가비지 컬렉터(GC)가 더 이상 쓰지 않는 데이터를 찾아서 자동으로 지워 주기 때문이다. 그런데도 누수가 생기는 이유는, GC가 "더 이상 쓰지 않는 데이터"를 판단하는 기준이 개발자가 생각하는 기준과 다르기 때문이다.

### GC는 "아직 참조되고 있는가"만 확인한다

GC는 어떤 데이터가 앞으로 쓰일지 예측하지 못한다. GC가 확인하는 것은 그 데이터를 아직 어딘가에서 참조하고 있는지뿐이다. GC는 전역 변수, 모듈 최상위 변수, 실행 중인 타이머처럼 페이지가 열려 있는 동안 계속 살아 있는 곳에서 출발해서 참조를 따라간다. 그리고 따라갈 수 있는 데이터는 모두 남겨 두고, 따라갈 수 없는 데이터만 지운다. 이 출발점을 GC 루트라고 부른다.

```js
const cache = new Map(); // 모듈 최상위 변수는 페이지가 열려 있는 동안 계속 살아 있다

function showProfile(user) {
  cache.set(user.id, user); // 저장만 하고 다시 읽지 않는다
  render(user);
}
```

`cache`에 저장한 사용자 데이터는 다시 쓰이지 않지만, `cache`가 계속 참조하고 있기 때문에 GC는 이 데이터를 지우지 않는다. 그래서 `showProfile`을 호출할 때마다 메모리 사용량이 조금씩 늘어난다.

즉 자바스크립트에서 누수란, 다 쓴 데이터를 무언가가 계속 참조하고 있는 상태를 말한다. 따라서 누수를 고치려면 그 참조를 찾아서 끊어야 한다. 다만 영상 프레임처럼 참조를 끊는 것만으로는 부족하고, 직접 정리해야 하는 브라우저 자원도 있다.

## 1. 누수를 방치하면 생기는 일

누수가 있어도 당장 오류가 발생하지는 않는다. 대신 페이지를 켜 둔 시간에 비례해서 문제가 조금씩 커진다. 그래서 새로고침을 자주 하는 개발 환경에서는 잘 드러나지 않다가, 대시보드나 채팅처럼 몇 시간씩 켜 두는 앱에서 드러난다.

- **화면이 점점 느려진다.** 메모리에 남은 데이터가 많아질수록 GC가 할 일이 늘어나서, 스크롤이나 애니메이션이 끊길 수 있다.
- **쓸데없는 작업이 계속 실행된다.** 해제되지 않은 리스너는 화면이 사라진 뒤에도 이벤트가 발생할 때마다 실행된다. 이미 닫힌 화면의 상태를 바꾸거나 서버에 요청을 보내서 버그를 일으키기도 한다.
- **기능이 멈춘다.** 영상 디코더나 카메라는 한 번에 다룰 수 있는 프레임 수가 정해져 있다. 그래서 다 쓴 프레임을 정리하지 않으면 새 프레임을 만들지 못해서 영상이 멈춘다.
- **탭이 종료된다.** 메모리 사용량이 탭의 한도에 도달하면, 크롬은 탭을 강제로 종료하고 "앗, 이런!" 오류 화면을 표시한다.

## 2. 제한 없이 쌓이는 데이터

배열이나 Map에 데이터를 추가하기만 하고 지우지 않는 경우다. 이 배열이나 Map이 오래 살아 있으면, 그 안의 데이터도 페이지를 닫을 때까지 지워지지 않는다.

### 문제 상황

```js
const history = [];

stream.on('data', (sample) => {
  history.push(sample); // 추가만 하고 지우지 않는다
});
```

차트를 그리는 데는 최근 값만 필요하지만, 배열에는 페이지를 연 순간부터 들어온 값이 모두 남는다.

### 해결 방법

보관할 개수나 기간에 상한을 정하고, 상한에 도달하면 오래된 데이터부터 지우거나 덮어쓴다. 캐시라면 LRU처럼 오랫동안 쓰지 않은 항목부터 지우는 방식을 사용한다.

```js
const history = new RingBuffer(MAX_SAMPLES); // 가득 차면 가장 오래된 값을 덮어쓴다

stream.on('data', (sample) => {
  history.push(sample);
});
```

## 3. 해제되지 않은 리스너

오래 살아 있는 객체에 리스너를 등록하고 해제하지 않는 경우다. 리스너가 등록된 객체가 리스너 함수를 계속 참조하므로, 리스너 함수와 그 함수가 참조하는 데이터도 함께 남는다. 이벤트 리스너뿐 아니라 타이머, Observer, 스토어 구독도 마찬가지다.

### 문제 상황

```jsx
function ValuePanel() {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const onData = (sample) => setValue(toValue(sample));
    stream.on('data', onData);
    // 해제 함수를 반환하지 않는다
  }, []);
}
```

컴포넌트가 화면에서 사라져도 `stream`이 `onData`를 계속 참조하므로, `onData`는 데이터가 들어올 때마다 계속 실행된다. 이때 사라진 컴포넌트의 `setValue`도 계속 호출되어, React 내부에는 처리되지 않는 업데이트가 계속 쌓인다.

### 해결 방법

리스너를 등록하는 코드를 작성할 때 해제하는 코드도 함께 작성한다. React에서는 effect의 정리 함수에서 리스너를 해제한다.

```jsx
useEffect(() => {
  const onData = (sample) => setValue(toValue(sample));
  stream.on('data', onData);
  return () => stream.off('data', onData); // 컴포넌트가 사라질 때 해제한다
}, []);
```

DOM 이벤트 리스너는 등록할 때 `AbortController`의 `signal`을 함께 넘겨 두면, `abort()`를 한 번 호출해서 여러 리스너를 한꺼번에 해제할 수 있다.

## 4. 정리하지 않은 브라우저 자원

영상 프레임(`VideoFrame`)이나 `URL.createObjectURL()`로 만든 URL처럼, 다 쓰고 나면 직접 정리해야 하는 브라우저 자원을 정리하지 않는 경우다. 이런 자원의 실제 데이터는 JS 힙 바깥이나 GPU 메모리에 있다. 그래서 참조를 끊어도 바로 정리되지 않고, 경우에 따라서는 페이지를 닫을 때까지 남는다.

### 문제 상황

```js
recent.push(frame); // 되감기를 위해 최근 프레임을 보관한다
if (recent.length > MAX_FRAMES) {
  recent.shift(); // 배열에서만 빼고 close()를 호출하지 않는다
}
```

배열에서 뺀 프레임의 픽셀 데이터는 GC가 실행될 때까지 GPU 메모리에 남는다. 이 메모리는 JS 힙에 포함되지 않기 때문에 JS 힙 그래프에는 나타나지 않는다.

### 해결 방법

자원을 다 쓴 시점에 정리 함수를 직접 호출한다. 자원마다 `close()`, `stop()`, `URL.revokeObjectURL()` 같은 정리 함수가 있다.

```js
recent.push(frame);
if (recent.length > MAX_FRAMES) {
  recent.shift().close(); // 배열에서 빼면서 픽셀 데이터도 바로 반납한다
}
```

## 5. 보이지 않는 참조 데이터

코드나 화면만 봐서는 참조가 남아 있다는 사실을 알기 어려운 경우다. 대표적인 예로 화면에서 제거한 DOM과 클로저가 공유하는 변수가 있다.

### 화면에서 제거한 DOM

#### 문제 상황

```js
const opened = []; // "모두 닫기" 기능을 위해 보관한다

function showTooltip() {
  const el = createTooltip();
  document.body.append(el);
  opened.push(el);
  setTimeout(() => el.remove(), 1000); // 화면에서만 제거한다
}
```

`el.remove()`는 요소를 문서에서만 떼어 낸다. 배열이 요소를 계속 참조하므로, 화면에서 사라진 요소가 메모리에는 남는다. 이런 요소를 분리된 DOM(detached DOM)이라고 부른다.

#### 해결 방법

DOM 요소를 화면에서 제거할 때는, 그 요소를 보관하던 목록에서도 함께 제거한다.

```js
const opened = new Set();

function showTooltip() {
  const el = createTooltip();
  document.body.append(el);
  opened.add(el);
  setTimeout(() => {
    el.remove();
    opened.delete(el); // 목록에서도 제거한다
  }, 1000);
}
```

### 클로저가 공유하는 변수

#### 문제 상황

```js
function refresh(values) {
  const previous = latest;
  if (previous && values.some((v, i) => v !== previous.values[i])) render();

  latest = { values, describe: () => `${values.length}개 값` };
}
```

`describe`는 `previous`를 사용하지 않는다. 하지만 같은 함수 안에서 만든 클로저들은 바깥 변수를 담아 두는 공간 하나를 함께 사용한다. `some`에 넘긴 함수가 `previous`를 사용하므로 그 공간에 `previous`가 들어가고, `describe`도 그 공간을 참조하게 된다. 그래서 새 데이터가 이전 데이터를 참조하고, 이전 데이터는 그보다 앞선 데이터를 참조하는 방식으로, 지금까지 만든 데이터가 모두 남는다.

#### 해결 방법

오래 남는 클로저와 이전 데이터를 사용하는 클로저를 같은 함수 안에서 만들지 않는다. 비교 로직을 별도 함수로 분리하면 `describe`가 `previous`를 참조하지 않게 된다.

```js
function hasChanged(previous, values) {
  return previous && values.some((v, i) => v !== previous.values[i]);
}

function refresh(values) {
  if (hasChanged(latest, values)) render();
  latest = { values, describe: () => `${values.length}개 값` };
}
```

## 6. 누수를 찾고 막는 법

### 누수 찾기

크롬 DevTools에서 다음 순서로 확인한다.

1. **Performance monitor**에서 JS 힙 크기와 DOM 노드 수를 지켜본다. 같은 동작을 반복했을 때 GC가 실행된 뒤에도 값이 계속 올라가면 누수를 의심한다.
2. **Memory** 패널에서 힙 스냅샷을 두 번 찍고, 두 번째 스냅샷을 Comparison 보기로 연다. 그리고 두 스냅샷 사이에 개수가 가장 많이 늘어난 객체를 찾는다.
3. 그 객체를 선택하고 **Retainers** 패널에서 참조 경로를 따라가면, 어떤 코드가 그 객체를 참조하고 있는지 확인할 수 있다.

유형에 따라서는 다음 방법이 더 빠르다.

- **분리된 DOM:** Memory 패널에서 **Detached elements** 프로파일을 기록하면, 문서에서 제거됐지만 메모리에 남은 요소를 바로 확인할 수 있다.
- **브라우저 자원:** JS 힙에는 나타나지 않으므로, 크롬 메뉴의 **도구 더보기 > 작업 관리자**에서 GPU 프로세스의 메모리를 확인한다.

### 지표를 볼 때 주의할 점

- 힙 스냅샷을 찍으면 GC가 먼저 실행된다. 그래서 GC가 뒤늦게라도 정리하는 누수는 스냅샷에 잘 나타나지 않는다.
- Performance monitor의 DOM 노드 수에는 분리된 DOM도 포함된다. 화면에 보이는 요소의 수는 그대로인데 이 값이 계속 늘어난다면 분리된 DOM을 의심한다.
- Performance monitor의 JS event listeners는 DOM 요소나 `window`처럼 브라우저가 제공하는 객체에 등록된 리스너만 센다. 직접 만든 이벤트 객체나 Socket.IO 같은 라이브러리에 등록된 리스너는 세지 않는다.
- 개발 모드에서는 React의 StrictMode가 effect를 한 번 더 실행하므로, 리스너 누수가 실제보다 두 배로 보인다. 메모리는 프로덕션 빌드에서 측정한다.

### 누수 막기

- **코드 리뷰에서 짝을 확인한다.** 데이터를 추가하는 코드에는 지우는 코드가, 리스너를 등록하는 코드에는 해제하는 코드가, 자원을 만드는 코드에는 정리하는 코드가 있는지 확인한다.
- **오래 켜 둔 상황을 테스트한다.** 데이터가 들어오는 속도를 높이거나 같은 동작을 반복해서, 몇 시간 동안 사용한 상황을 짧은 시간 안에 재현하고 메모리 추세를 확인한다. 이 과정을 자동화해 두면 누수가 다시 생겼을 때 바로 알 수 있다.
- **정리 코드를 공통 모듈로 만든다.** 링 버퍼나 구독 헬퍼처럼 자주 쓰는 정리 코드를 공통 모듈로 만들어 두면, 정리 코드를 빠뜨리는 실수가 줄어든다.

### 측정 기록

2026-09-30에 맥북에서 케이스당 30초씩 측정했다. 메모리 증가량은 5초마다 GC를 강제로 실행한 뒤 측정한 JS 힙의 추세다. 영상 프레임은 강제 GC가 누수를 가리기 때문에, GC를 브라우저에 맡기고 GPU 프로세스의 메모리를 측정했다.

| 시나리오 | 누수 코드 | 수정 코드 |
|---|---|---|
| 스트림만 실행 (기준선, 100배속) | 1분에 0.21MB | |
| 계속 쌓이는 배열 (100배속) | 1분에 44.67MB | 1분에 0.23MB |
| 정리하지 않은 구독 (초당 10번 열고 닫기) | 1분에 41.81MB, 리스너 51개에서 300개로 증가 | 1분에 0.44MB, 리스너 1개 |
| 닫지 않은 영상 프레임 (15fps) | GPU 최고 547MB | GPU 최고 242MB |
| 화면에서 제거한 DOM (초당 툴팁 20개) | 1분에 18.92MB, 남은 툴팁 579개 | 1분에 0.40MB, 남은 툴팁 0개 |
| 클로저가 공유하는 변수 (초당 10번 교체) | 1분에 46.21MB, 남은 데이터 묶음 300개 | 1분에 0.36MB, 남은 데이터 묶음 4개 |

정리하지 않은 구독은 사라진 컴포넌트에 업데이트가 계속 쌓이기 때문에, 측정 시간이 길어질수록 메모리가 늘어나는 속도도 빨라진다.

### 참고 자료

- [자바스크립트의 메모리 관리](https://developer.mozilla.org/ko/docs/Web/JavaScript/Guide/Memory_management), MDN
- [addEventListener의 signal 옵션](https://developer.mozilla.org/ko/docs/Web/API/EventTarget/addEventListener), MDN
- [Effect로 동기화하기](https://ko.react.dev/learn/synchronizing-with-effects), React 공식 문서
- [Fix memory problems](https://developer.chrome.com/docs/devtools/memory-problems), Chrome DevTools
- [Record heap snapshots](https://developer.chrome.com/docs/devtools/memory-problems/heap-snapshots), Chrome DevTools
- [Performance monitor](https://developer.chrome.com/docs/devtools/performance-monitor), Chrome DevTools
- [WebCodecs](https://www.w3.org/TR/webcodecs/), W3C
