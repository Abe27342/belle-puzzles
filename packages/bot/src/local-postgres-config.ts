export interface LocalPostgresConfiguration {
	readonly guildIds: readonly string[];
	readonly databaseUrl: string;
	readonly serviceBaseUrl: string;
}

function ids(value: string | undefined, name: string): string[] {
	const result = value?.split(',').map((id) => id.trim());
	if (!result?.length || result.some((id) => !/^[0-9]{1,20}$/.test(id))) {
		throw new Error(`${name} must contain explicit Discord guild IDs.`);
	}
	return [...new Set(result)];
}

function loopbackUrl(
	value: string | undefined,
	name: string,
	protocols: string[]
): URL {
	let url: URL;
	try {
		url = new URL(value ?? '');
	} catch {
		throw new Error(`${name} must be an explicit loopback URL.`);
	}
	if (
		!protocols.includes(url.protocol) ||
		!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
		url.search ||
		url.hash
	) {
		throw new Error(
			`${name} must use loopback without query overrides or fragments.`
		);
	}
	return url;
}

export function readLocalServiceToken(
	environment: Readonly<Record<string, string | undefined>>
): string {
	const token = environment.PUZZLEHUNT_SERVICE_TOKEN;
	if (!token || !/^\S{32,}$/.test(token)) {
		throw new Error(
			'PUZZLEHUNT_SERVICE_TOKEN requires at least 32 non-whitespace characters.'
		);
	}
	return token;
}

/** DATABASE_URL alone never opts a bot into PostgreSQL. */
export function readLocalPostgresConfiguration(
	environment: Readonly<Record<string, string | undefined>>
): LocalPostgresConfiguration | undefined {
	if (environment.LOCAL_POSTGRES_GUILD_IDS === undefined) return undefined;
	const guildIds = ids(
		environment.LOCAL_POSTGRES_GUILD_IDS,
		'LOCAL_POSTGRES_GUILD_IDS'
	);
	const allowed = ids(environment.GUILD_ALLOW_LIST, 'GUILD_ALLOW_LIST');
	const blocked =
		environment.GUILD_BLOCK_LIST?.split(',').map((id) => id.trim()) ?? [];
	if (guildIds.some((id) => !allowed.includes(id) || blocked.includes(id))) {
		throw new Error(
			'Every LOCAL_POSTGRES_GUILD_IDS entry must be explicitly allowed and not blocked.'
		);
	}
	loopbackUrl(environment.DATABASE_URL, 'DATABASE_URL', [
		'postgres:',
		'postgresql:',
	]);
	const service = loopbackUrl(
		environment.PUZZLEHUNT_SERVICE_BASE_URL,
		'PUZZLEHUNT_SERVICE_BASE_URL',
		['http:', 'https:']
	);
	if (service.username || service.password) {
		throw new Error(
			'PUZZLEHUNT_SERVICE_BASE_URL must not contain credentials.'
		);
	}
	readLocalServiceToken(environment);
	if (!/^[0-9]{1,20}$/.test(environment.CLIENT_ID ?? '')) {
		throw new Error('CLIENT_ID must be the local Discord application ID.');
	}
	if (
		environment.VITE_BELLE_BOT_CLIENT_ID !== undefined &&
		environment.VITE_BELLE_BOT_CLIENT_ID !== environment.CLIENT_ID
	) {
		throw new Error(
			'CLIENT_ID and service/browser VITE_BELLE_BOT_CLIENT_ID must match.'
		);
	}
	return {
		guildIds,
		databaseUrl: environment.DATABASE_URL,
		serviceBaseUrl: service.href.replace(/\/+$/, ''),
	};
}
