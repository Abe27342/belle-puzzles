import { describe, expect, it } from 'vitest';
import { readServiceConfiguration } from '../config.js';

const database = { DATABASE_URL: 'postgresql://localhost/belle_test' };

describe('Puzzlehunt service configuration', () => {
	it('defaults to a separate service port without a development authentication bypass', () => {
		expect(readServiceConfiguration(database)).toMatchObject({
			host: '0.0.0.0',
			port: 3001,
			allowedOrigins: [],
			serviceToken: undefined,
		});
	});

	it('allows loopback, an ephemeral port, and explicit local browser origins', () => {
		expect(
			readServiceConfiguration({
				...database,
				HOST: '127.0.0.1',
				PORT: '0',
				PUZZLEHUNT_ALLOWED_ORIGINS:
					'http://localhost:9000/, https://example.test',
			})
		).toMatchObject({
			host: '127.0.0.1',
			port: 0,
			allowedOrigins: ['http://localhost:9000', 'https://example.test'],
		});
	});

	it.each(['', ' ', '-1', '65536', '1.5', '0x10', '1e3'])(
		'rejects invalid ports (%s)',
		(PORT) => {
			expect(() =>
				readServiceConfiguration({ ...database, PORT })
			).toThrow('PORT');
		}
	);

	it.each([
		'*',
		'https://example.test/path',
		'https://name:password@example.test',
		'https://example.test?query',
	])('rejects non-origin CORS configuration (%s)', (origin) => {
		expect(() =>
			readServiceConfiguration({
				...database,
				PUZZLEHUNT_ALLOWED_ORIGINS: origin,
			})
		).toThrow('PUZZLEHUNT_ALLOWED_ORIGINS');
	});

	it('requires a database URL and does not print its value in configuration errors', () => {
		expect(() => readServiceConfiguration({})).toThrow(
			'DATABASE_URL is required'
		);
		expect(() =>
			readServiceConfiguration({ DATABASE_URL: 'not-a-postgres-url' })
		).toThrow('must be a PostgreSQL connection URL');
	});

	it('requires separate, nonempty trusted-service and Discord bot credentials', () => {
		expect(() =>
			readServiceConfiguration({
				...database,
				PUZZLEHUNT_SERVICE_TOKEN: 'short',
			})
		).toThrow('at least 32');
		expect(() =>
			readServiceConfiguration({
				...database,
				PUZZLEHUNT_SERVICE_TOKEN: 'x'.repeat(32),
			})
		).toThrow('DISCORD_TOKEN');
		expect(
			readServiceConfiguration({
				...database,
				PUZZLEHUNT_SERVICE_TOKEN: 'x'.repeat(32),
				DISCORD_TOKEN: 'bot-token',
			}).serviceToken
		).toBe('x'.repeat(32));
	});
});
