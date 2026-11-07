import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/test/**/*.spec.ts'],
		globalSetup: ['src/test/fixtures/fluid-service.ts'],
		testTimeout: 15000,
	},
});
