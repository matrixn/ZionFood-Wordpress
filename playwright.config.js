import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: './tests/e2e',
    workers: 1,
    timeout: 120000,
    use: {
        baseURL: process.env.ZF_WP_URL || 'http://127.0.0.1:8021',
        browserName: 'chromium',
        reducedMotion: 'reduce',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    reporter: 'list',
});
