export interface PuzzlehuntServiceConfiguration {
	readonly databaseUrl: string;
	readonly host: string;
	readonly port: number;
	readonly allowedOrigins: readonly string[];
	readonly serviceToken?: string;
	readonly discordBotToken?: string;
}

export function readServiceConfiguration(
	environment: Readonly<Record<string, string | undefined>>
): PuzzlehuntServiceConfiguration {
	const databaseUrl = environment.DATABASE_URL;
	if (!databaseUrl) {
		throw new Error('DATABASE_URL is required.');
	}
	try {
		if (
			!['postgres:', 'postgresql:'].includes(
				new URL(databaseUrl).protocol
			)
		) {
			throw new Error('Invalid protocol.');
		}
	} catch {
		throw new Error('DATABASE_URL must be a PostgreSQL connection URL.');
	}
	const portText = environment.PORT ?? '3001';
	const port = Number(portText);
	if (!/^\d+$/.test(portText) || port > 65535) {
		throw new Error('PORT must be an integer from 0 to 65535.');
	}
	const host = environment.HOST ?? '0.0.0.0';
	if (host.length === 0) {
		throw new Error('HOST cannot be empty.');
	}
	const allowedOrigins: string[] = [];
	for (const origin of environment.PUZZLEHUNT_ALLOWED_ORIGINS?.split(',') ??
		[]) {
		let url: URL;
		try {
			url = new URL(origin.trim());
		} catch {
			throw new Error(
				'PUZZLEHUNT_ALLOWED_ORIGINS must contain HTTP origins separated by commas.'
			);
		}
		if (
			!['http:', 'https:'].includes(url.protocol) ||
			url.username ||
			url.password ||
			url.pathname !== '/' ||
			url.search ||
			url.hash
		) {
			throw new Error(
				'PUZZLEHUNT_ALLOWED_ORIGINS must contain origins, not URLs with paths or credentials.'
			);
		}
		allowedOrigins.push(url.origin);
	}
	const serviceToken = environment.PUZZLEHUNT_SERVICE_TOKEN;
	if (serviceToken !== undefined && !/^\S{32,}$/.test(serviceToken)) {
		throw new Error(
			'PUZZLEHUNT_SERVICE_TOKEN must contain at least 32 non-whitespace characters.'
		);
	}
	const discordBotToken = environment.DISCORD_TOKEN;
	if (
		serviceToken !== undefined &&
		(!discordBotToken || !/^\S+$/.test(discordBotToken))
	) {
		throw new Error(
			'DISCORD_TOKEN is required when trusted-service access is enabled.'
		);
	}
	return {
		databaseUrl,
		host,
		port,
		allowedOrigins,
		serviceToken,
		discordBotToken,
	};
}
