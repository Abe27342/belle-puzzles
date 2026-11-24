/**
 * Build-time configuration for the opt-in local HTTP path.
 *
 * @remarks
 * Only configured loopback HTTP origins may receive browser OAuth credentials.
 * Neither hunt descriptors nor Discord pins choose the service destination.
 * Database and trusted-service credentials must never be exposed as VITE variables.
 */
interface LocalHuntEnvironment {
	PROD: boolean;
	MODE: string;
	VITE_BELLE_BOT_BASE_URL?: string;
	VITE_BELLE_BOT_CLIENT_ID?: string;
	VITE_PUZZLEHUNT_SERVICE_BASE_URL?: string;
}

function isLoopback(hostname: string): boolean {
	return ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

function loopbackOrigin(value: string | undefined): string {
	const url = new URL(value ?? '');
	if (
		url.protocol !== 'http:' ||
		!isLoopback(url.hostname) ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash
	) {
		throw new Error('Local hunt APIs must use loopback HTTP origins.');
	}
	return url.origin;
}

/** Configuration, never hunt metadata, chooses the credential destination. */
export function getLocalHuntServiceUrl(
	env: LocalHuntEnvironment = import.meta.env,
	page: Pick<Location, 'hostname' | 'protocol'> = window.location
): string {
	if (
		env.PROD ||
		env.MODE !== 'local-postgres' ||
		page.protocol !== 'http:' ||
		!isLoopback(page.hostname)
	) {
		throw new Error(
			'HTTP puzzlehunts are enabled only in local-postgres development mode on loopback HTTP.'
		);
	}
	if (!/^\d{17,20}$/.test(env.VITE_BELLE_BOT_CLIENT_ID ?? '')) {
		throw new Error(
			'Set VITE_BELLE_BOT_CLIENT_ID to the local bot application ID.'
		);
	}
	loopbackOrigin(env.VITE_BELLE_BOT_BASE_URL);
	return loopbackOrigin(env.VITE_PUZZLEHUNT_SERVICE_BASE_URL);
}
