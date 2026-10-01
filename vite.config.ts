import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: { port: 5180, strictPort: true },
  preview: { port: 4173 },
  // 힙 스냅샷에서 함수·클래스 이름으로 참조 경로를 읽을 수 있게, 프로덕션 빌드도 이름을 압축하지 않는다
  build: { minify: false },
});
