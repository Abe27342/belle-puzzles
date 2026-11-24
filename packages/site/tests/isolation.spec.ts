// @vitest-environment node
import { expect, it } from 'vitest';
import deploymentConfig from '../staticwebapp.config.json';
import { isolationHeaders, z3AssetCacheControl } from '../solver-assets';

it('uses the same site-wide isolation policies in development and deployment', () => {
	expect(deploymentConfig.globalHeaders).toEqual(isolationHeaders);
	expect(isolationHeaders).toEqual({
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Cross-Origin-Embedder-Policy': 'require-corp',
	});
	expect(deploymentConfig.navigationFallback.rewrite).toBe('/index.html');
});

it('keeps API authentication restrictions without adding restrictions to public solvers', () => {
	expect(
		deploymentConfig.routes.filter((route) => route.allowedRoles)
	).toEqual([{ route: '/api/*', allowedRoles: ['authenticated'] }]);
});

it('caches only versioned Z3 assets with a long immutable lifetime', () => {
	expect(deploymentConfig.routes.find((route) => route.headers)).toEqual({
		route: '/solver-assets/z3/*',
		headers: { 'Cache-Control': z3AssetCacheControl },
	});
	expect(z3AssetCacheControl).toBe('public, max-age=31536000, immutable');
});
