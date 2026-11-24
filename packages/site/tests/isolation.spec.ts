// @vitest-environment node
import { expect, it } from 'vitest';
import deploymentConfig from '../staticwebapp.config.json';
import { isolationHeaders } from '../solver-assets';

it('uses the same site-wide isolation policies in development and deployment', () => {
	expect(deploymentConfig.globalHeaders).toEqual(isolationHeaders);
	expect(isolationHeaders).toEqual({
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Cross-Origin-Embedder-Policy': 'require-corp',
	});
	expect(deploymentConfig.navigationFallback.rewrite).toBe('/index.html');
});

it('keeps API authentication restrictions without adding restrictions to public solvers', () => {
	expect(deploymentConfig.routes).toEqual([
		{ route: '/api/*', allowedRoles: ['authenticated'] },
	]);
});
