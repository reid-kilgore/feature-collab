import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    timeout: 30000,
    use: {
        baseURL: 'http://localhost:5177',
        headless: true,
    },
    webServer: {
        command: 'npm run dev -- --port 5177',
        url: 'http://localhost:5177',
        reuseExistingServer: true,
        timeout: 10000,
    },
});
