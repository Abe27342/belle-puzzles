import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
	build: {
		sourcemap: true,
	},
	plugins: [react()],
	server: {
		port: 5173,
		strictPort: true,
	},
	preview: {
		port: 5173,
		strictPort: true,
	},
});
