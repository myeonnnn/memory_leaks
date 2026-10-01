type Listener<T> = (payload: T) => void;

/**
 * Socket.IO 클라이언트처럼 on/off로 구독하는 최소 이벤트 버스.
 * DOM 이벤트가 아니라서 DevTools의 "JS event listeners" 지표에는 잡히지 않는다. Socket.IO도 마찬가지다.
 */
export class Emitter<Events extends Record<string, unknown>> {
  private readonly listeners: { [K in keyof Events]?: Listener<Events[K]>[] } = {};

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    (this.listeners[event] ??= []).push(fn);
  }

  off<K extends keyof Events>(event: K, fn: Listener<Events[K]>): void {
    const list = this.listeners[event];
    if (!list) return;
    const index = list.indexOf(fn);
    if (index !== -1) list.splice(index, 1);
  }

  listenerCount(event: keyof Events): number {
    return this.listeners[event]?.length ?? 0;
  }

  protected emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const list = this.listeners[event];
    if (!list) return;
    // 콜백 안에서 off가 불려도 순회가 깨지지 않게 복사본을 돈다
    for (const fn of list.slice()) fn(payload);
  }
}
