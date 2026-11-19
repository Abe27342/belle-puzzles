import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { persistReducer, REHYDRATE } from 'redux-persist';
import storage from 'redux-persist/lib/storage';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import type { IPuzzlehuntSession } from '@belle-puzzles/puzzlehunt-model/model';
import { PuzzlehuntModel } from '@belle-puzzles/puzzlehunt-model/model';
import {
	applyHuntCommand,
	snowflake,
	type HuntCommandRequest,
	type HuntSnapshot,
} from '@belle-puzzles/puzzlehunt-model/document';
import type { PuzzlehuntDescriptor } from '@belle-puzzles/puzzlehunt-model/http';
import { getLocalHuntServiceUrl } from '../../services/localHuntConfig';
import {
	belleBotApi,
	parsePuzzlehuntContext,
} from '../../services/belleBotApi';
import { discordApi } from '../../services/discordApi';
import { swaApi } from '../../services/swaApi';
import { rootReducer } from '../../store/reducer';
import { clientPrincipalReceived, login, logout } from '../../store/auth';
import type { AppStore } from '../../store/store';
import { loadPuzzlehunt } from './loadPuzzlehunt';
import { Puzzles } from './puzzles';
import { EditNameModal } from './modals';

vi.hoisted(() => {
	vi.stubEnv('VITE_BELLE_BOT_BASE_URL', 'http://localhost:3000');
});

vi.mock('./connection', () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock('@belle-puzzles/puzzlehunt-model/fluid', () => ({
	loadExistingPuzzlehunt: vi.fn(),
}));
vi.mock('../../fast', () => ({
	Anchor: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a {...props} />
	),
	Button: ({ appearance, ...props }) => <button {...props} />,
	Card: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
	Dialog: ({ modal, ...props }) => <div role="dialog" {...props} />,
	Menu: (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />,
	MenuItem: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button {...props} />
	),
	TextField: ({ autofocus, value = '', ...props }) => (
		<input value={value} {...props} />
	),
	TreeItem: (props: React.HTMLAttributes<HTMLDivElement>) => (
		<div {...props} />
	),
	TreeView: (props: React.HTMLAttributes<HTMLDivElement>) => (
		<div {...props} />
	),
	Toolbar: (props: React.HTMLAttributes<HTMLDivElement>) => (
		<div {...props} />
	),
	Skeleton: () => <div>Loading hunt</div>,
}));

const id = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const guildId = '123456789012345678';
const rootId = id(2);
const puzzleId = id(3);
const configuration = {
	googleFolderId: 'folder',
	indexId: 'index',
	allPuzzlesRoleId: 'role',
	loggingChannelIds: {
		puzzleAdd: 'add',
		puzzleSolve: 'solve',
		puzzleStatusUpdate: 'status',
	},
};
const postgres: PuzzlehuntDescriptor = {
	backend: 'postgres',
	guildId,
	huntId: id(1),
	name: 'HTTP Hunt',
	configuration,
};
const fluid: PuzzlehuntDescriptor = {
	backend: 'fluid',
	fluidFileId: 'fluid-file',
	name: 'Fluid Hunt',
	googleFolderId: 'folder',
	indexId: 'index',
	allPuzzlesRoleId: 'role',
};
const localEnv = {
	PROD: false,
	MODE: 'local-postgres',
	VITE_BELLE_BOT_BASE_URL: 'http://localhost:3000',
	VITE_BELLE_BOT_CLIENT_ID: '123456789012345678',
	VITE_PUZZLEHUNT_SERVICE_BASE_URL: 'http://localhost:3001',
};
const page = { hostname: 'localhost', protocol: 'http:' };
const json = (value: unknown, status = 200) =>
	new Response(JSON.stringify(value), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});

function snapshot(): HuntSnapshot {
	return {
		huntId: id(1),
		guildId: snowflake(guildId),
		revision: 0,
		schemaVersion: 1,
		document: {
			name: 'HTTP Hunt',
			configuration: { googleFolderId: 'folder' },
			nodes: {
				[rootId]: {
					id: rootId,
					type: 'round',
					name: 'Root',
					url: 'https://hunt.test/round',
					position: 0,
				},
				[puzzleId]: {
					id: puzzleId,
					type: 'puzzle',
					name: 'Puzzle',
					url: 'https://hunt.test/puzzle',
					parentId: rootId,
					position: 0,
				},
			},
		},
	};
}

function deferred<T>() {
	let resolve: (value: T) => void;
	let reject: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function makeStore(): AppStore {
	const store = configureStore({
		reducer: persistReducer({ key: 'http-test', storage }, rootReducer),
		middleware: (getDefault) =>
			getDefault({ serializableCheck: false }).concat(
				discordApi.middleware,
				swaApi.middleware,
				belleBotApi.middleware
			),
	});
	store.dispatch(
		clientPrincipalReceived({
			identityProvider: 'aad',
			userId: 'user',
			userDetails: 'User',
			userRoles: [],
		})
	);
	setToken(store, 'first-token');
	return store;
}

function setToken(store: AppStore, value: string) {
	store.dispatch(
		login({
			service: 'discord',
			context: { token: { value, expiry: '2999-01-01' }, scopes: [] },
		})
	);
}

function fluidSession(): IPuzzlehuntSession {
	return {
		puzzlehunt: new PuzzlehuntModel(
			{
				read: async () => snapshot(),
				submit: async () => {
					throw new Error('Unexpected Fluid transport call');
				},
			},
			snapshot()
		),
		state: { status: 'open' },
		close: vi.fn(),
		subscribeLifecycle: vi.fn(() => () => {}),
	};
}

function backend() {
	let selected: unknown = postgres;
	let state = snapshot();
	const receipts = new Map<string, number>();
	const commands: HuntCommandRequest[] = [];
	let metadataOverride: (() => Promise<Response>) | undefined;
	let commandOverride:
		| ((request: HuntCommandRequest) => Promise<Response>)
		| undefined;
	let readOverride: (() => Promise<Response>) | undefined;
	const commit = (request: HuntCommandRequest) => {
		const replayed = receipts.has(request.commandId);
		if (!replayed) {
			state = {
				...state,
				revision: state.revision + 1,
				document: applyHuntCommand(
					state.document,
					request.command,
					1234
				).document,
			};
			receipts.set(request.commandId, state.revision);
		}
		return json({
			receipt: {
				commandId: request.commandId,
				committedRevision: receipts.get(request.commandId),
			},
			replayed,
			update: { type: 'snapshot', snapshot: state },
		});
	};
	const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
		const url = new URL(
			typeof input === 'string'
				? input
				: input instanceof URL
				? input.href
				: input.url
		);
		if (url.port === '3000')
			return metadataOverride ? metadataOverride() : json(selected);
		if (url.pathname.endsWith('/commands')) {
			const request: HuntCommandRequest = JSON.parse(String(init.body));
			commands.push(request);
			return commandOverride ? commandOverride(request) : commit(request);
		}
		if (readOverride) return readOverride();
		if (url.pathname !== `/guilds/${guildId}/hunts/${state.huntId}`) {
			throw new Error(`Unexpected request: ${url}`);
		}
		return json(url.search ? { type: 'snapshot', snapshot: state } : state);
	});
	vi.stubGlobal('fetch', fetch);
	return {
		fetch,
		commands,
		commit,
		get state() {
			return state;
		},
		set state(value: HuntSnapshot) {
			state = value;
		},
		select(value: unknown) {
			selected = value;
		},
		onMetadata(value?: () => Promise<Response>) {
			metadataOverride = value;
		},
		onCommand(value?: (request: HuntCommandRequest) => Promise<Response>) {
			commandOverride = value;
		},
		onRead(value?: () => Promise<Response>) {
			readOverride = value;
		},
	};
}

function showSite(store: AppStore) {
	const router = createMemoryRouter(
		[
			{
				path: '/hunt/:guildId',
				element: (
					<>
						<Link to="/logout">Leave hunt</Link>
						<Puzzles />
					</>
				),
			},
			{ path: '/logout', element: <div>Logged out page</div> },
		],
		{ initialEntries: [`/hunt/${guildId}`] }
	);
	return {
		...render(
			<Provider store={store}>
				<RouterProvider router={router} />
			</Provider>
		),
		router,
	};
}

function edit(menu: string, placeholder?: string, value?: string) {
	fireEvent.contextMenu(document.getElementById(`puzzle-obj-${puzzleId}`));
	fireEvent.click(screen.getByText(menu));
	if (placeholder)
		fireEvent.change(screen.getByPlaceholderText(placeholder), {
			target: { value },
		});
}

let store: AppStore;
beforeEach(() => {
	vi.stubEnv('MODE', 'local-postgres');
	vi.stubEnv('PROD', false);
	vi.stubEnv('VITE_BELLE_BOT_CLIENT_ID', localEnv.VITE_BELLE_BOT_CLIENT_ID);
	vi.stubEnv(
		'VITE_PUZZLEHUNT_SERVICE_BASE_URL',
		localEnv.VITE_PUZZLEHUNT_SERVICE_BASE_URL
	);
	store = makeStore();
});
afterEach(() => {
	cleanup();
	store.dispatch(belleBotApi.util.resetApiState());
	store.dispatch(discordApi.util.resetApiState());
	store.dispatch(swaApi.util.resetApiState());
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('Local website configuration and metadata', () => {
	it('accepts a legacy Fluid response and discards untrusted destination fields', () => {
		const { backend: _, ...legacy } = fluid;
		expect(parsePuzzlehuntContext(legacy)).toEqual(fluid);
		expect(
			parsePuzzlehuntContext({
				...postgres,
				serviceUrl: 'https://untrusted.test',
				token: 'untrusted',
			})
		).toEqual(postgres);
		expect(getLocalHuntServiceUrl(localEnv, page)).toBe(
			'http://localhost:3001'
		);
	});

	it.each([
		{ PROD: true },
		{ MODE: 'production' },
		{ MODE: 'remote-bot' },
		{ MODE: 'local-bot' },
		{ VITE_PUZZLEHUNT_SERVICE_BASE_URL: 'https://localhost:3001' },
		{ VITE_PUZZLEHUNT_SERVICE_BASE_URL: 'http://untrusted.test' },
		{ VITE_PUZZLEHUNT_SERVICE_BASE_URL: 'http://user:pass@localhost:3001' },
		{ VITE_PUZZLEHUNT_SERVICE_BASE_URL: 'http://localhost:3001/api' },
		{ VITE_PUZZLEHUNT_SERVICE_BASE_URL: 'http://localhost:3001/?token=x' },
		{ VITE_BELLE_BOT_BASE_URL: 'https://deployed.test' },
		{ VITE_BELLE_BOT_CLIENT_ID: '' },
	])('rejects unsafe or non-opt-in configuration %j', (overrides) => {
		expect(() =>
			getLocalHuntServiceUrl({ ...localEnv, ...overrides }, page)
		).toThrow();
	});

	it('does not enable HTTP on a deployed page even with local build variables', () => {
		expect(() =>
			getLocalHuntServiceUrl(localEnv, {
				hostname: 'deployed.test',
				protocol: 'http:',
			})
		).toThrow();
	});
});

describe('Backend loading and lifecycle', () => {
	it('keeps Fluid on its existing session path without HTTP access', async () => {
		vi.stubEnv('MODE', 'remote-bot');
		const fetch = vi.fn();
		vi.stubGlobal('fetch', fetch);
		const { loadExistingPuzzlehunt } = await import(
			'@belle-puzzles/puzzlehunt-model/fluid'
		);
		const flushed = deferred<void>();
		const session = fluidSession();
		vi.spyOn(session.puzzlehunt, 'flush').mockReturnValue(flushed.promise);
		vi.mocked(loadExistingPuzzlehunt).mockResolvedValue(session);
		const loaded = await loadPuzzlehunt(fluid, store, () => true, guildId);
		expect(loadExistingPuzzlehunt).toHaveBeenCalledWith({}, 'fluid-file');
		expect(fetch).not.toHaveBeenCalled();
		loaded.dispose();
		expect(session.close).not.toHaveBeenCalled();
		flushed.resolve();
		await flushed.promise;
		await waitFor(() => expect(session.close).toHaveBeenCalledOnce());
	});

	it('retains the synchronous Fluid modal submission UX without awaiting flush', () => {
		const session = fluidSession();
		const close = vi.fn();
		const change = vi
			.spyOn(session.puzzlehunt, 'changeName')
			.mockImplementation(() => {});
		const flush = vi.spyOn(session.puzzlehunt, 'flush');
		render(
			<EditNameModal
				puzzleObj={session.puzzlehunt.getPuzzle(puzzleId)}
				puzzlehunt={session.puzzlehunt}
				close={close}
			/>
		);
		fireEvent.change(screen.getByPlaceholderText('new puzzle name'), {
			target: { value: 'Fluid rename' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Change Name' }));
		expect(change).toHaveBeenCalledOnce();
		expect(close).toHaveBeenCalledOnce();
		expect(flush).not.toHaveBeenCalled();
	});

	it('loads the exact HTTP scope, reads fresh OAuth tokens, and refuses abandoned requests', async () => {
		const service = backend();
		const { createClient } = await import('./connection');
		vi.mocked(createClient).mockClear();
		let active = true;
		const loaded = await loadPuzzlehunt(
			postgres,
			store,
			() => active,
			guildId
		);
		expect(service.fetch.mock.calls[0]).toMatchObject([
			`http://localhost:3001/guilds/${guildId}/hunts/${id(1)}`,
			{
				headers: { Authorization: 'Bearer first-token' },
				redirect: 'error',
				credentials: 'omit',
			},
		]);
		expect(createClient).not.toHaveBeenCalled();
		setToken(store, 'new-token');
		await loaded.model.refresh();
		expect(service.fetch.mock.calls[1][1].headers).toMatchObject({
			Authorization: 'Bearer new-token',
		});
		active = false;
		await expect(loaded.model.refresh()).rejects.toThrow();
		expect(service.fetch).toHaveBeenCalledTimes(2);
		loaded.dispose();
	});

	it('refuses PostgreSQL under default settings without sending a request', async () => {
		vi.stubEnv('MODE', 'remote-bot');
		const service = backend();
		await expect(
			loadPuzzlehunt(postgres, store, () => true, guildId)
		).rejects.toThrow('local-postgres');
		expect(service.fetch).not.toHaveBeenCalled();
	});

	it('retains the original model and IDs on unexpected unmount, even if active metadata changed', async () => {
		const service = backend();
		service.onCommand(async () => {
			throw new Error('lost response');
		});
		let active = true;
		const loaded = await loadPuzzlehunt(
			postgres,
			store,
			() => active,
			guildId
		);
		loaded.model.changeName(loaded.model.getPuzzle(puzzleId), 'Retained');
		await expect(loaded.model.flush()).rejects.toThrow('lost response');
		active = false;
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		loaded.dispose();
		const unload = new Event('beforeunload', { cancelable: true });
		window.dispatchEvent(unload);
		expect(unload.defaultPrevented).toBe(true);
		expect(log).toHaveBeenCalled();
		const resumed = await loadPuzzlehunt(
			{ ...postgres, huntId: id(9) },
			store,
			() => true,
			guildId
		);
		expect(resumed).toBe(loaded);
		if (resumed.backend !== 'postgres') throw new Error('Expected HTTP');
		service.onCommand();
		await resumed.model.retryPending();
		expect(service.commands).toHaveLength(2);
		expect(service.commands[1]).toEqual(service.commands[0]);
		expect(resumed.descriptor).toEqual(postgres);
		resumed.dispose();
	});
});

describe('Non-live website and settlement', () => {
	it('ignores persisted metadata until a fresh response arrives and does not poll HTTP documents', async () => {
		const service = backend();
		const eventSource = vi.fn();
		vi.stubGlobal('EventSource', eventSource);
		service.select(fluid);
		const cached = store.dispatch(
			belleBotApi.endpoints.getPuzzlehuntContext.initiate({ guildId })
		);
		await cached.unwrap();
		cached.unsubscribe();
		store.dispatch({
			type: REHYDRATE,
			key: 'root',
			payload: { belleBotApi: store.getState().belleBotApi },
		});
		const metadata = deferred<Response>();
		service.onMetadata(() => metadata.promise);
		showSite(store);
		expect(screen.queryByText('Fluid Hunt')).not.toBeInTheDocument();
		expect(screen.queryByText('HTTP Hunt')).not.toBeInTheDocument();
		await act(async () => {
			metadata.resolve(json(postgres));
		});
		await screen.findByText('HTTP Hunt');
		expect(screen.getAllByText('Discord pending')).toHaveLength(2);
		expect(screen.getByText('Spreadsheet pending')).toBeInTheDocument();
		expect(document.querySelector('a[href*="undefined"]')).toBeNull();
		const count = service.fetch.mock.calls.length;
		vi.useFakeTimers();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
		});
		expect(service.fetch).toHaveBeenCalledTimes(count);
		expect(eventSource).not.toHaveBeenCalled();
	});

	it('unsubscribes on unmount and restores retained edits even if metadata is unavailable', async () => {
		const service = backend();
		service.onCommand(async () => {
			throw new Error('offline');
		});
		const originalSubscribe = PuzzlehuntModel.prototype.subscribe;
		const unsubscribe = vi.fn();
		vi.spyOn(PuzzlehuntModel.prototype, 'subscribe').mockImplementation(
			function (listener) {
				const remove = originalSubscribe.call(this, listener);
				return () => {
					unsubscribe();
					remove();
				};
			}
		);
		const view = showSite(store);
		await screen.findByText('HTTP Hunt');
		edit('Change name', 'new puzzle name', 'Retained rename');
		fireEvent.click(screen.getByRole('button', { name: 'Change Name' }));
		await screen.findByText(/Save outcome uncertain\. Retry/);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		view.unmount();
		expect(unsubscribe).toHaveBeenCalledOnce();
		service.onMetadata(async () => json({}, 503));
		showSite(store);
		await screen.findByText('Retry pending edits');
		service.onCommand();
		fireEvent.click(screen.getByText('Retry pending edits'));
		await waitFor(() =>
			expect(
				screen.queryByText('Retry pending edits')
			).not.toBeInTheDocument()
		);
		expect(service.commands).toHaveLength(2);
		expect(service.commands[1]).toEqual(service.commands[0]);
		fireEvent.click(screen.getByText('Refresh hunt'));
		await screen.findByText(/503/);
	});

	it('refreshes metadata and associations explicitly and shows refresh failures', async () => {
		const service = backend();
		showSite(store);
		await screen.findByText('HTTP Hunt');
		service.state = {
			...service.state,
			revision: 1,
			document: applyHuntCommand(
				service.state.document,
				{
					type: 'set-property',
					nodeId: puzzleId,
					property: 'sheetId',
					value: 'new-sheet',
				},
				1234
			).document,
		};
		expect(screen.queryByText('Spreadsheet')).not.toBeInTheDocument();
		fireEvent.click(screen.getByText('Refresh hunt'));
		await screen.findByText('Spreadsheet');
		expect(screen.getByText('Spreadsheet')).toHaveAttribute(
			'href',
			'https://docs.google.com/spreadsheets/d/new-sheet'
		);
		service.onRead(async () => json({}, 503));
		fireEvent.click(screen.getByText('Refresh hunt'));
		await screen.findAllByText(/503/);
		service.onRead();
		fireEvent.click(screen.getByText('Refresh hunt'));
		await waitFor(() =>
			expect(screen.queryAllByText(/503/)).toHaveLength(0)
		);
	});

	it('requires deliberate reopening when the exact active hunt changes', async () => {
		const service = backend();
		showSite(store);
		await screen.findByText('HTTP Hunt');
		service.select({ ...postgres, name: 'Next hunt', huntId: id(9) });
		fireEvent.click(screen.getByText('Refresh hunt'));
		await screen.findByText('Open selected hunt');
		expect(screen.queryByText('Next hunt')).not.toBeInTheDocument();
		expect(
			service.fetch.mock.calls.filter(([url]) =>
				String(url).includes(id(9))
			)
		).toHaveLength(0);
		service.state = { ...service.state, huntId: id(9) };
		fireEvent.click(screen.getByText('Open selected hunt'));
		await screen.findByText('Next hunt');
	});

	it('does not silently switch backends on refresh', async () => {
		const service = backend();
		const { loadExistingPuzzlehunt } = await import(
			'@belle-puzzles/puzzlehunt-model/fluid'
		);
		vi.mocked(loadExistingPuzzlehunt)
			.mockClear()
			.mockResolvedValue(fluidSession());
		showSite(store);
		await screen.findByText('HTTP Hunt');
		service.select(fluid);
		fireEvent.click(screen.getByText('Refresh hunt'));
		await screen.findByText('Open selected hunt');
		expect(loadExistingPuzzlehunt).not.toHaveBeenCalled();
		fireEvent.click(screen.getByText('Open selected hunt'));
		await screen.findByText('Fluid Hunt');
		expect(screen.queryByText('Refresh hunt')).not.toBeInTheDocument();
	});

	it.each([
		['Change name', 'new puzzle name', 'Renamed', 'Change Name'],
		['Change URL', 'new puzzle URL', 'https://new.test', 'Change URL'],
		[
			'Change sheet ID',
			'new puzzle sheet ID',
			'direct-sheet',
			'Change Sheet ID',
		],
		['Solve', 'Answer', 'ANSWER', 'Solve puzzle'],
		['Delete this puzzle', undefined, undefined, 'Delete'],
		['Add a sibling puzzle', 'name', 'Added', 'Add puzzle'],
	])(
		'waits for settlement and disables duplicate %s submissions',
		async (menu, placeholder, value, submit) => {
			const service = backend();
			const response = deferred<Response>();
			service.onCommand(() => response.promise);
			showSite(store);
			await screen.findByText('HTTP Hunt');
			edit(menu, placeholder, value);
			if (submit === 'Add puzzle')
				fireEvent.change(screen.getByPlaceholderText('url'), {
					target: { value: 'https://new.test' },
				});
			const button = screen.getByRole('button', { name: submit });
			fireEvent.click(button);
			fireEvent.click(button);
			await waitFor(() => expect(service.commands).toHaveLength(1));
			expect(screen.getByRole('dialog')).toBeInTheDocument();
			expect(button).toBeDisabled();
			expect(screen.getByText('Cancel')).toBeDisabled();
			expect(screen.getByText('Refresh hunt')).toBeDisabled();
			fireEvent.keyUp(document, { key: 'Escape' });
			expect(screen.getByRole('dialog')).toBeInTheDocument();
			await act(async () => {
				response.resolve(service.commit(service.commands[0]));
			});
			await waitFor(() =>
				expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
			);
			expect(service.commands).toHaveLength(1);
			if (submit === 'Change Sheet ID') {
				expect(service.commands[0].command).toMatchObject({
					type: 'set-property',
					property: 'sheetId',
					value: 'direct-sheet',
				});
			}
		}
	);

	it('keeps uncertain edits on their original IDs, blocks logout, and retries without duplicating mutation', async () => {
		const service = backend();
		service.onCommand(async (request) => {
			service.commit(request);
			throw new Error('response lost');
		});
		showSite(store);
		await screen.findByText('HTTP Hunt');
		edit('Add a sibling puzzle', 'name', 'Once');
		fireEvent.change(screen.getByPlaceholderText('url'), {
			target: { value: 'https://new.test' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Add puzzle' }));
		await screen.findByText(/Save outcome uncertain\. Retry/);
		fireEvent.click(screen.getByText('Leave hunt'));
		await screen.findByText(/Settle pending edits before leaving/);
		expect(screen.queryByText('Logged out page')).not.toBeInTheDocument();
		expect(service.commands).toHaveLength(1);
		service.onCommand();
		fireEvent.click(screen.getByText('Retry pending edit'));
		await waitFor(() =>
			expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
		);
		expect(service.commands).toHaveLength(2);
		expect(service.commands[1]).toEqual(service.commands[0]);
		expect(
			Object.values(service.state.document.nodes).filter(
				(node) => node.name === 'Once'
			)
		).toHaveLength(1);
		fireEvent.click(screen.getByText('Leave hunt'));
		await screen.findByText('Logged out page');
	});

	it('shows a definite rejection, rolls back the optimistic view, and permits a corrected submission', async () => {
		const service = backend();
		service.onCommand(async () =>
			json(
				{ error: { code: 'conflict', message: 'Rejected by server' } },
				409
			)
		);
		showSite(store);
		await screen.findByText('HTTP Hunt');
		edit('Change name', 'new puzzle name', 'Rejected name');
		fireEvent.click(screen.getByRole('button', { name: 'Change Name' }));
		await screen.findByText('Save rejected. Rejected by server');
		expect(screen.getByText('Puzzle')).toBeInTheDocument();
		expect(
			screen.queryByText('Retry pending edit')
		).not.toBeInTheDocument();
		service.onCommand();
		fireEvent.change(screen.getByPlaceholderText('new puzzle name'), {
			target: { value: 'Accepted' },
		});
		fireEvent.click(screen.getByRole('button', { name: 'Change Name' }));
		await waitFor(() =>
			expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
		);
		expect(service.commands[1].commandId).not.toBe(
			service.commands[0].commandId
		);
	});

	it.each([401, 403, 404, 409, 503])(
		'surfaces metadata failure %s without loading a document',
		async (status) => {
			const service = backend();
			service.onMetadata(async () =>
				json({ body: 'Metadata failure' }, status)
			);
			showSite(store);
			await screen.findByRole('alert');
			expect(screen.getByRole('alert')).toHaveTextContent(String(status));
			expect(service.fetch).toHaveBeenCalledTimes(1);
		}
	);

	it('rejects metadata from a different guild before loading its document', async () => {
		const service = backend();
		service.select({ ...postgres, guildId: 'foreign-guild' });
		showSite(store);
		await screen.findByRole('alert');
		expect(service.fetch).toHaveBeenCalledTimes(1);
	});

	it('ignores a late load after route departure and closes its Fluid session', async () => {
		const service = backend();
		service.select(fluid);
		const pending = deferred<IPuzzlehuntSession>();
		const { loadExistingPuzzlehunt } = await import(
			'@belle-puzzles/puzzlehunt-model/fluid'
		);
		vi.mocked(loadExistingPuzzlehunt)
			.mockClear()
			.mockReturnValue(pending.promise);
		const session = fluidSession();
		vi.spyOn(session.puzzlehunt, 'subscribe');
		showSite(store);
		await waitFor(() =>
			expect(loadExistingPuzzlehunt).toHaveBeenCalledOnce()
		);
		fireEvent.click(screen.getByText('Leave hunt'));
		await screen.findByText('Logged out page');
		await act(async () => {
			pending.resolve(session);
		});
		expect(session.close).toHaveBeenCalledOnce();
		expect(session.puzzlehunt.subscribe).not.toHaveBeenCalled();
	});

	it('does not send credentials after logout while an HTTP load is pending', async () => {
		const service = backend();
		const pending = deferred<Response>();
		service.onRead(() => pending.promise);
		const view = showSite(store);
		await waitFor(() => expect(service.fetch).toHaveBeenCalledTimes(2));
		view.unmount();
		store.dispatch(logout());
		await act(async () => {
			pending.resolve(json(service.state));
		});
		expect(service.fetch).toHaveBeenCalledTimes(2);
		expect(screen.queryByText('HTTP Hunt')).not.toBeInTheDocument();
	});

	it('suspends on auth loss and reopens retained edits for the original account', async () => {
		const service = backend();
		service.onCommand(async () => {
			throw new Error('offline');
		});
		showSite(store);
		await screen.findByText('HTTP Hunt');
		edit('Change name', 'new puzzle name', 'Retained rename');
		fireEvent.click(screen.getByRole('button', { name: 'Change Name' }));
		await screen.findByText(/Save outcome uncertain\. Retry/);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		act(() => {
			store.dispatch(logout());
		});
		await screen.findByText(/Sign in before reopening/);
		const count = service.fetch.mock.calls.length;
		act(() => {
			store.dispatch(
				clientPrincipalReceived({
					identityProvider: 'aad',
					userId: 'user',
					userDetails: 'User',
					userRoles: [],
				})
			);
			setToken(store, 'renewed-token');
		});
		await screen.findByText('Retry pending edits');
		expect(service.fetch).toHaveBeenCalledTimes(count);
		service.onCommand();
		fireEvent.click(screen.getByText('Retry pending edits'));
		await waitFor(() =>
			expect(
				screen.queryByText('Retry pending edits')
			).not.toBeInTheDocument()
		);
		expect(service.commands[1]).toEqual(service.commands[0]);
		expect(service.fetch.mock.calls.at(-1)[1].headers).toMatchObject({
			Authorization: 'Bearer renewed-token',
		});
	});
});
