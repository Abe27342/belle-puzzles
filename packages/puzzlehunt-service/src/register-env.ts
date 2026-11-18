import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Host/root settings take precedence over the shared website defaults.
for (const path of ['../../../../.env', '../../../site/.env']) {
	const { error } = config({
		path: fileURLToPath(new URL(path, import.meta.url)),
	});
	if (error && !('code' in error && error.code === 'ENOENT')) {
		throw error;
	}
}
