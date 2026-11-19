import { describe, expect, it } from 'vitest';
import {
	parsePuzzlehuntDescriptor,
	parsePuzzlehuntPin,
} from '@belle-puzzles/puzzlehunt-model/http';
import { readLocalPostgresConfiguration } from '../local-postgres-config.js';

const environment = {
	LOCAL_POSTGRES_GUILD_IDS: '123,456',
	GUILD_ALLOW_LIST: '123,456,789',
	DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/local_hunts',
	PUZZLEHUNT_SERVICE_BASE_URL: 'http://127.0.0.1:3001',
	PUZZLEHUNT_SERVICE_TOKEN: 'local-test-token-'.repeat(3),
	CLIENT_ID: '12345',
	VITE_BELLE_BOT_CLIENT_ID: '12345',
};

describe('Local PostgreSQL opt-in', () => {
	it('ignores database/service settings without an explicit opt-in', () => {
		expect(
			readLocalPostgresConfiguration({
				DATABASE_URL: 'postgresql://remote.example/production',
				PUZZLEHUNT_SERVICE_BASE_URL: 'invalid',
			})
		).toBeUndefined();
	});

	it('requires explicit compatible guild authorization and loopback endpoints', () => {
		expect(readLocalPostgresConfiguration(environment)).toEqual({
			guildIds: ['123', '456'],
			databaseUrl: environment.DATABASE_URL,
			serviceBaseUrl: environment.PUZZLEHUNT_SERVICE_BASE_URL,
		});
	});

	it.each([
		{ LOCAL_POSTGRES_GUILD_IDS: '' },
		{ LOCAL_POSTGRES_GUILD_IDS: '123,' },
		{ GUILD_ALLOW_LIST: undefined },
		{ GUILD_ALLOW_LIST: '123' },
		{ GUILD_BLOCK_LIST: '456' },
		{ DATABASE_URL: 'postgres://remote.example/local_hunts' },
		{ DATABASE_URL: 'postgres://127.0.0.1/local?host=remote.example' },
		{ DATABASE_URL: 'https://127.0.0.1/local' },
		{ PUZZLEHUNT_SERVICE_BASE_URL: undefined },
		{ PUZZLEHUNT_SERVICE_BASE_URL: 'http://remote.example:3001' },
		{ PUZZLEHUNT_SERVICE_BASE_URL: 'http://127.0.0.1:3001?token=secret' },
		{ PUZZLEHUNT_SERVICE_BASE_URL: 'http://name:secret@127.0.0.1:3001' },
		{ PUZZLEHUNT_SERVICE_TOKEN: '' },
		{ CLIENT_ID: undefined },
		{ VITE_BELLE_BOT_CLIENT_ID: 'different' },
	])('rejects unsafe opt-in configuration: %j', (overrides) => {
		expect(() =>
			readLocalPostgresConfiguration({ ...environment, ...overrides })
		).toThrow();
	});
});

describe('Backend pins and public descriptors', () => {
	const fluid = {
		name: 'Legacy',
		fluidFileId: 'file-id',
		googleFolderId: 'folder',
		indexId: 'index',
		allPuzzlesRoleId: 'role',
	};
	it('keeps legacy Fluid pins readable without inferring a backend from environment', () => {
		expect(parsePuzzlehuntPin(fluid)).toEqual(fluid);
		expect(
			parsePuzzlehuntDescriptor({ backend: 'fluid', ...fluid })
		).toEqual({ backend: 'fluid', ...fluid });
	});
	it('accepts only the versioned guild-scoped marker, never a URL or active pointer', () => {
		const pin = { version: 1, backend: 'postgres', guildId: '123' };
		expect(parsePuzzlehuntPin(pin)).toEqual(pin);
		for (const bad of [
			{ ...pin, version: 2 },
			{ ...pin, huntId: crypto.randomUUID() },
			{ ...pin, serviceUrl: 'https://attacker.example' },
			{ ...pin, ...fluid },
			{ ...fluid, backend: 'unknown' },
		])
			expect(() => parsePuzzlehuntPin(bad)).toThrow();
	});
	it('constructs a small exact PostgreSQL DTO and rejects incomplete configuration', () => {
		const descriptor = {
			backend: 'postgres',
			guildId: '123',
			huntId: crypto.randomUUID(),
			name: 'Local',
			configuration: {
				googleFolderId: 'folder',
				indexId: 'index',
				allPuzzlesRoleId: 'role',
				loggingChannelIds: {
					puzzleAdd: 'log',
					puzzleSolve: 'log',
					puzzleStatusUpdate: 'status',
				},
			},
		};
		expect(
			parsePuzzlehuntDescriptor({
				...descriptor,
				serviceToken: 'not-public',
				huntContextMessage: {},
			})
		).toEqual(descriptor);
		expect(() =>
			parsePuzzlehuntDescriptor({ ...descriptor, configuration: {} })
		).toThrow();
	});
});
