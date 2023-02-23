/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_BELLE_BOT_CLIENT_ID: string;
	readonly VITE_BELLE_BOT_BASE_URL: string;
	readonly VITE_FLUID_CONNECTION_TYPE: 'remote' | 'local';
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
