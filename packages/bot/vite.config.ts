/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
	test: {
		testTimeout: process.env.DEBUGGING ? 999_999_999 : 5_000,
		hookTimeout: process.env.DEBUGGING ? 999_999_999 : 10_000,
		env: {
			USE_LOCAL_SERVICE: 'true',
			CLIENT_ID: '1019695303026290698',
		},
		include: ['src/test/**/*.spec.ts'],
		globalSetup: [
			fileURLToPath(import.meta.resolve('@belle-puzzles/puzzlehunt-model/testing/fluid-service')),
		],
		setupFiles: [
			fileURLToPath(import.meta.resolve('@belle-puzzles/puzzlehunt-model/testing/fluid-endpoint')),
		],
	},
});
