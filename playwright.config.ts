// 브라우저 E2E 설정: 빌드된 앱(키 없음, 픽스처·재생 모드)을 띄워 데모 흐름을 끝까지 돈다
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3210", viewport: { width: 1280, height: 900 } },
  webServer: {
    command: "npx next start -p 3210",
    url: "http://localhost:3210",
    reuseExistingServer: true,
    env: { YOUCAM_API_KEY: "", ANTHROPIC_API_KEY: "" },
  },
});
