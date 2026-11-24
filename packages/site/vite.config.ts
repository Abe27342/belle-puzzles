/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { isolationHeaders, solverAssets } from './solver-assets';

// https://vitejs.dev/config/
export default defineConfig({
	build: {
		sourcemap: true,
	},
	worker: {
		format: 'es',
	},
	optimizeDeps: {
		include: [
			'@belle-puzzles/solver > z3-solver',
			'@belle-puzzles/solver > z3-solver/build/kill-threads.js',
		],
	},
	plugins: [!process.env.VITEST && react(), solverAssets()],
	server: {
		port: 5173,
		strictPort: true,
		headers: isolationHeaders,
	},
	preview: {
		port: 5173,
		strictPort: true,
		headers: isolationHeaders,
	},
	test: {
		globals: true,
		environment: 'jsdom',
		setupFiles: './tests/setup.ts',
		testTimeout: process.env.DEBUGGING ? 999_999_999 : 5_000,
		hookTimeout: process.env.DEBUGGING ? 999_999_999 : 10_000,
	},
});
