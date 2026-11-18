import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const { error } = config({
	path: fileURLToPath(new URL('../../../../.env', import.meta.url)),
});
if (error && !('code' in error && error.code === 'ENOENT')) {
	throw error;
}
