import { SharedMap } from 'fluid-framework';
import {
	EagerCheckout,
	BuildNode,
	BuildTreeNode,
	Change,
	NodeId,
	initialTree,
	SharedTree,
	StablePlace,
	StableRange,
	StableNodeId,
	TraitLabel,
	TreeView,
	TreeNodeHandle,
	TreeNodeSequence,
	TraitMap,
	TraitLocation,
	WriteFormat,
} from '@fluid-experimental/tree';
import { waitContainerToCatchUp } from '@fluidframework/container-loader';
import { AzureClient } from '@fluidframework/azure-client';
import { IFluidContainer } from '@fluidframework/fluid-static';
import type { IPuzzlehunt as SharedPuzzlehunt } from './model/types.js';
import type {
	PuzzlehuntChangeEvent,
	PuzzlehuntView,
	PuzzlehuntRound,
} from './model/types.js';
import { projectPuzzlehuntView } from './model/types.js';
import { diffPuzzlehuntViews } from './model/changes.js';
import { HuntCommandError, snowflake } from './document.js';
import type {
	DocumentDiscordAssociation,
	DocumentNode,
	DocumentPuzzle,
	DocumentRound,
} from './document.js';

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) {
		throw new Error(`Assertion failed: ${message}`);
	}
}

class AFRSharedTree extends SharedTree {
	public static getFactory() {
		return SharedTree.getFactory(WriteFormat.v0_1_1);
	}
}

const schema = {
	initialObjects: {
		hunt: AFRSharedTree,
		guildInfo: SharedMap,
	},
};

interface PuzzlehuntLoadResult {
	puzzlehunt: IPuzzlehunt;
	id: string;
	disposer: { dispose: () => void };
	// TODO: There may be a better thing to expose. But right now, container.close events aren't properly surfaced
	// to users of this model. This could be a bug source in the future.
	container: IFluidContainer;
}

export const createNewPuzzlehunt = async (
	client: AzureClient,
	guildId: string,
	logChannelIds?: LoggingChannelIds
): Promise<PuzzlehuntLoadResult> =>
	createPuzzlehunt(client, (hunt) => {
		hunt.setGuildId(guildId);
		if (logChannelIds) {
			hunt.setLoggingChannelIds(logChannelIds);
		}
	});

export async function createNewPuzzlehuntFromExisting(
	client: AzureClient,
	existingHunt: IPuzzlehunt
): Promise<PuzzlehuntLoadResult> {
	assert(
		existingHunt instanceof Puzzlehunt,
		'This API relies on internals of the tree-based Puzzlehunt implementation.'
	);
	return createPuzzlehunt(client, (hunt) => hunt.copyFrom(existingHunt));
}

async function createPuzzlehunt(
	client: AzureClient,
	editBeforeAttach: (puzzlehunt: Puzzlehunt) => void
): Promise<PuzzlehuntLoadResult> {
	const { container } = await client.createContainer(schema);
	// May want to initialize state here.
	const puzzlehunt = new Puzzlehunt(container);
	editBeforeAttach(puzzlehunt);
	const id = await container.attach();
	const disposer = {
		dispose: () => {
			if (!container.isDirty) {
				container.dispose();
			} else {
				console.log(
					`Delaying close of puzzlehunt ${id} due to unsaved changes.`
				);
				container.once('saved', () => {
					console.log(`Completed delayed close of puzzlehunt ${id}.`);
					container.dispose();
				});
			}
		},
	};
	return { id, puzzlehunt, disposer, container };
}

export const loadExistingPuzzlehunt = async (
	client: AzureClient,
	id: string
): Promise<PuzzlehuntLoadResult> => {
	const { container } = await client.getContainer(id, schema);
	await waitContainerToCatchUp((container as any).container);
	return {
		puzzlehunt: new Puzzlehunt(container),
		disposer: container,
		id,
		container,
	};
};

export interface DiscordPuzzleInfo {
	channel: { /* channel ID */ id: string } | string;
	role: { /* role ID */ id: string } | string;
}

export interface DiscordRoundInfo extends DiscordPuzzleInfo {
	indexChannel: { /* channel ID */ id: string } | string;
}

export interface IPuzzlehunt extends SharedPuzzlehunt {
	/** Plain stable-ID view, shared with the Fluid model adapter and event consumers. */
	readonly view: PuzzlehuntView;
	augmentWithDiscord(
		puzzle: DocumentPuzzle,
		discordInfo: DiscordPuzzleInfo
	): void;
	augmentWithDiscord(
		round: DocumentRound,
		discordInfo: DiscordRoundInfo
	): void;
	get guildId(): string;
	setGuildId(id: string): void;
	get loggingChannelIds(): LoggingChannelIds | undefined;
	setLoggingChannelIds(ids: LoggingChannelIds): void;
}

export interface LoggingChannelIds {
	puzzleAdd: string;
	puzzleSolve: string;
	puzzleStatusUpdate: string;
}

interface StringNode {
	type: 'string';
	value: string;
	parentage: TraitLocation;
}

interface NumberNode {
	type: 'number';
	value: number;
	parentage: TraitLocation;
}

export type Puzzle = DocumentPuzzle;
export type Round = PuzzlehuntRound;

const puzzleDef = '34edbf0a-7479-4124-ae4f-7091724dc58a';
const roundDef = '81cfc8eb-fd54-4071-b991-fea6db4456d7';
const stringDef = '13574b71-cd65-4672-98bd-e0c045f04f6a';
const numberDef = 'f13ac46f-a39d-4124-a327-abdadcc57f10';

const traitLabels = {} as unknown as {
	name: TraitLabel;
	url: TraitLabel;
	answer: TraitLabel;
	sheetId: TraitLabel;
	children: TraitLabel;
	roleId: TraitLabel;
	channelId: TraitLabel;
	indexChannelId: TraitLabel;
	status: TraitLabel;
	lastStatusUpdate: TraitLabel;
};

[
	'name',
	'url',
	'answer',
	'sheetId',
	'children',
	'roleId',
	'channelId',
	'indexChannelId',
	'status',
	'lastStatusUpdate',
].forEach((val) => {
	(traitLabels as any)[val] = val as TraitLabel;
});

const makeString = (content: string): BuildNode => ({
	definition: stringDef,
	payload: content,
});

const makeNumber = (content: number): BuildNode => ({
	definition: numberDef,
	payload: content,
});

const makePuzzleBuildNode = (
	name: string,
	url: string,
	identifier?: NodeId,
	discordInfo?: DiscordPuzzleInfo,
	sheetId?: string
): BuildTreeNode => {
	let channelId: BuildNode | undefined;
	let roleId: BuildNode | undefined;
	if (discordInfo !== undefined) {
		channelId = makeString(
			typeof discordInfo.channel === 'string'
				? discordInfo.channel
				: discordInfo.channel.id
		);
		roleId = makeString(
			typeof discordInfo.role === 'string'
				? discordInfo.role
				: discordInfo.role.id
		);
	}
	return {
		definition: puzzleDef,
		identifier,
		traits: {
			[traitLabels.name]: makeString(name),
			[traitLabels.url]: makeString(url),
			[traitLabels.channelId]: channelId,
			[traitLabels.roleId]: roleId,
			[traitLabels.sheetId]:
				sheetId !== undefined ? makeString(sheetId) : undefined,
		},
	};
};

const makeRoundBuildNode = (
	name: string,
	url: string,
	identifier?: NodeId,
	discordInfo?: DiscordRoundInfo
): BuildTreeNode => {
	let channelId: BuildNode | undefined;
	let indexChannelId: BuildNode | undefined;
	let roleId: BuildNode | undefined;
	if (discordInfo !== undefined) {
		channelId = makeString(
			typeof discordInfo.channel === 'string'
				? discordInfo.channel
				: discordInfo.channel.id
		);
		indexChannelId = makeString(
			typeof discordInfo.indexChannel === 'string'
				? discordInfo.indexChannel
				: discordInfo.indexChannel.id
		);
		roleId = makeString(
			typeof discordInfo.role === 'string'
				? discordInfo.role
				: discordInfo.role.id
		);
	}
	return {
		definition: roundDef,
		identifier,
		traits: {
			[traitLabels.name]: makeString(name),
			[traitLabels.url]: makeString(url),
			[traitLabels.channelId]: channelId,
			[traitLabels.roleId]: roleId,
			[traitLabels.indexChannelId]: indexChannelId,
		},
	};
};

function readCell<T>(trait: TreeNodeSequence<T>): T {
	assert(trait.length === 1, 'Expected trait to have exactly one property.');
	return trait[0];
}

function readOptional<T>(trait: TreeNodeSequence<T>): T | undefined {
	return !trait || trait.length === 0 ? undefined : readCell(trait);
}

function str(content: any): string {
	assert(typeof content === 'string', 'Content should have been a string.');
	return content;
}

class RoundHandle implements PuzzlehuntRound {
	private readonly handle: TreeNodeHandle;
	private readonly traits: TraitMap<TreeNodeHandle>;
	public readonly type = 'round';
	// color: string;
	// idxMsgId: string; used in previous version to update discord stuff
	constructor(
		private readonly view: TreeView,
		private readonly nodeId: NodeId,
		private readonly hunt: SharedTree
	) {
		this.handle = new TreeNodeHandle(view, nodeId);
		this.traits = this.handle.traits;
	}

	public get id(): string {
		return this.hunt.convertToStableNodeId(this.nodeId);
	}

	public get name(): string {
		return str(readCell(this.traits.name).payload);
	}
	public get url(): string {
		return str(readCell(this.traits.url).payload);
	}

	public get discord(): DocumentDiscordAssociation | undefined {
		const roleIdNode = readOptional(this.traits.roleId);
		const channelIdNode = readOptional(this.traits.channelId);
		const indexChannelIdNode = readOptional(this.traits.indexChannelId);
		if (roleIdNode && channelIdNode && indexChannelIdNode) {
			return {
				roleId: snowflake(str(roleIdNode.payload)),
				channelId: snowflake(str(channelIdNode.payload)),
				indexChannelId: snowflake(str(indexChannelIdNode.payload)),
			};
		}
		return undefined;
	}

	public get parentId(): string | undefined {
		const parentId = this.handle.node.parentage.parent;
		const grandparent = this.view.tryGetParentViewNode(parentId);
		// grandparent === undefined implies parent is the root node. So this round has no parent.
		return grandparent === undefined
			? undefined
			: this.hunt.convertToStableNodeId(parentId);
	}

	public get position(): number {
		return this.view.getIndexInTrait(this.nodeId);
	}

	public get children(): (DocumentPuzzle | PuzzlehuntRound)[] {
		return Array.from(
			this.handle.node.traits.get(traitLabels.children) ?? [],
			(childId) => {
				const childHandle = getHandle(this.view, childId, this.hunt);
				assert(
					childHandle.type === 'puzzle' ||
						childHandle.type === 'round',
					`Round should only have puzzle and round children but had a ${childHandle.type}.`
				);
				return childHandle;
			}
		);
	}
}

class StringHandle implements StringNode {
	private readonly handle: TreeNodeHandle;
	private readonly traits: TraitMap<TreeNodeHandle>;
	public readonly type = 'string';
	constructor(private readonly view: TreeView, public readonly id: NodeId) {
		this.handle = new TreeNodeHandle(view, id);
	}

	public get value(): string {
		return this.handle.payload;
	}

	public get parentage(): TraitLocation {
		return this.handle.node.parentage;
	}
}

class NumberHandle implements NumberNode {
	private readonly handle: TreeNodeHandle;
	private readonly traits: TraitMap<TreeNodeHandle>;
	public readonly type = 'number';
	constructor(private readonly view: TreeView, public readonly id: NodeId) {
		this.handle = new TreeNodeHandle(view, id);
	}

	public get value(): number {
		return this.handle.payload;
	}

	public get parentage(): TraitLocation {
		return this.handle.node.parentage;
	}
}

class PuzzleHandle implements DocumentPuzzle {
	private readonly handle: TreeNodeHandle;
	private readonly traits: TraitMap<TreeNodeHandle>;
	public readonly type = 'puzzle';
	// color: string;
	constructor(
		private readonly view: TreeView,
		private readonly nodeId: NodeId,
		private readonly hunt: SharedTree
	) {
		this.handle = new TreeNodeHandle(view, nodeId);
		this.traits = this.handle.traits;
	}

	public get id(): string {
		return this.hunt.convertToStableNodeId(this.nodeId);
	}

	public get name(): string {
		return str(readCell(this.traits.name).payload);
	}
	public get url(): string {
		return str(readCell(this.traits.url).payload);
	}

	public get discord(): DocumentDiscordAssociation | undefined {
		const roleIdNode = readOptional(this.traits.roleId);
		const channelIdNode = readOptional(this.traits.channelId);
		if (roleIdNode && channelIdNode) {
			return {
				roleId: snowflake(str(roleIdNode.payload)),
				channelId: snowflake(str(channelIdNode.payload)),
			};
		}
		return undefined;
	}

	public get parentId(): string {
		const parentId = this.handle.node.parentage.parent;
		assert(
			parentId !== this.view.root,
			'A puzzle must have a parent round.'
		);
		return this.hunt.convertToStableNodeId(parentId);
	}

	public get position(): number {
		return this.view.getIndexInTrait(this.nodeId);
	}

	// Google drive id
	public get sheetId(): string | undefined {
		return readOptional(this.traits.sheetId)?.payload;
	}

	public get answer(): string | undefined {
		return readOptional(this.traits.answer)?.payload;
	}

	public get status(): string | undefined {
		return readOptional(this.traits.status)?.payload;
	}

	// Note: client-side timestamp. It would be great to leverage platform-provided attribution for this prop.
	public get lastStatusUpdate(): number | undefined {
		return readOptional(this.traits.lastStatusUpdate)?.payload;
	}
}

function replace(
	content: BuildNode | TreeNodeSequence<BuildNode>,
	location: TraitLocation
): Change[] {
	return [
		Change.delete(StableRange.all(location)),
		...Change.insertTree(content, StablePlace.atEndOf(location)),
	];
}

const getHandle = (
	view: TreeView,
	id: NodeId,
	hunt: SharedTree
): DocumentPuzzle | PuzzlehuntRound | StringHandle | NumberNode | undefined => {
	const viewNode = view.getViewNode(id);
	switch (viewNode.definition) {
		case roundDef:
			return new RoundHandle(view, id, hunt);
		case puzzleDef:
			return new PuzzleHandle(view, id, hunt);
		case stringDef:
			return new StringHandle(view, id);
		case numberDef:
			return new NumberHandle(view, id);
	}
};

class Puzzlehunt implements IPuzzlehunt {
	private readonly hunt: SharedTree;
	private readonly checkout: EagerCheckout;
	private readonly guildInfoMap: SharedMap;
	private readonly changeListeners = new Set<
		(event: PuzzlehuntChangeEvent) => void
	>();

	constructor(container: IFluidContainer) {
		const { hunt, guildInfo } = container.initialObjects as {
			guildInfo: SharedMap;
			hunt: SharedTree;
		};
		this.hunt = hunt;
		this.checkout = new EagerCheckout(hunt);
		this.hunt.on('error', (err) => console.log('SharedTree error:', err));
		this.checkout.on('error', (err) =>
			console.log('EagerCheckout error:', err)
		);
		this.checkout.on('viewChange', (before: TreeView, after: TreeView) => {
			// Raw leaf/structural deltas stay private; domain projection also captures
			// sibling positions and every member of an added/removed subtree.
			const delta = before.delta(after);
			if (
				delta.added.length === 0 &&
				delta.removed.length === 0 &&
				delta.changed.length === 0
			) {
				return;
			}
			const event = diffPuzzlehuntViews(
				this.projectView(before),
				this.projectView(after)
			);
			if (event.changes.length > 0) {
				for (const listener of this.changeListeners) {
					listener(event);
				}
			}
		});
		this.guildInfoMap = guildInfo;
	}

	public subscribeChanges(
		listener: (event: PuzzlehuntChangeEvent) => void
	): () => void {
		this.changeListeners.add(listener);
		return () => this.changeListeners.delete(listener);
	}

	public get view(): PuzzlehuntView {
		return this.projectView(this.checkout.currentView);
	}

	private projectView(view: TreeView): PuzzlehuntView {
		const nodes: Record<string, DocumentNode> = {};
		const visit = (node: DocumentPuzzle | PuzzlehuntRound): void => {
			const { id, name, url, parentId, position, discord } = node;
			const common = {
				id,
				name,
				url,
				parentId,
				position,
				...(discord === undefined ? {} : { discord }),
			};
			if (node.type === 'round') {
				nodes[id] = { ...common, type: 'round' };
				node.children.forEach(visit);
			} else {
				nodes[id] = {
					...common,
					type: 'puzzle',
					parentId: node.parentId,
					...(node.answer === undefined
						? {}
						: { answer: node.answer }),
					...(node.status === undefined
						? {}
						: { status: node.status }),
					...(node.lastStatusUpdate === undefined
						? {}
						: { lastStatusUpdate: node.lastStatusUpdate }),
					...(node.sheetId === undefined
						? {}
						: { sheetId: node.sheetId }),
				};
			}
		};
		(
			view.getViewNode(view.root).traits.get(traitLabels.children) ?? []
		).forEach((id) => {
			const node = getHandle(view, id, this.hunt);
			assert(
				node?.type === 'round' || node?.type === 'puzzle',
				'Expected a domain node.'
			);
			visit(node);
		});
		return projectPuzzlehuntView({ nodes });
	}

	#normalizeId(id: string): NodeId {
		// Accept existing numeric menu values as well as stable IDs from new embeds.
		if (/^-?\d+$/.test(id)) {
			return Number(id) as NodeId;
		}
		return this.hunt.convertToNodeId(id as StableNodeId);
	}

	public setGuildId(id: string): void {
		this.guildInfoMap.set('id', id);
	}

	public get guildId(): string {
		return this.guildInfoMap.get('id');
	}

	public get loggingChannelIds(): LoggingChannelIds | undefined {
		return this.guildInfoMap.get('logChannelIds');
	}

	public setLoggingChannelIds(ids: LoggingChannelIds): void {
		this.guildInfoMap.set('logChannelIds', ids);
	}

	public addPuzzle(name: string, url: string, round: Round): Puzzle {
		this.getRound(round.id);
		const id = this.hunt.generateNodeId();
		this.checkout.applyEdit(
			...Change.insertTree(
				makePuzzleBuildNode(name, url, id),
				StablePlace.atEndOf({
					parent: this.#normalizeId(round.id),
					label: 'children' as TraitLabel,
				})
			)
		);
		return this.getPuzzle(this.hunt.convertToStableNodeId(id));
	}

	public addPuzzles(
		puzzles: { name: string; url: string }[],
		round: Round
	): void {
		this.getRound(round.id);
		this.checkout.applyEdit(
			...Change.insertTree(
				puzzles.map(({ name, url }) => makePuzzleBuildNode(name, url)),
				StablePlace.atEndOf({
					parent: this.#normalizeId(round.id),
					label: 'children' as TraitLabel,
				})
			)
		);
	}

	public addRound(name: string, url: string, parentRound?: Round): Round {
		if (parentRound !== undefined) {
			this.getRound(parentRound.id);
		}
		const id = this.hunt.generateNodeId();
		const parentNodeId =
			parentRound === undefined
				? this.hunt.convertToNodeId(initialTree.identifier)
				: this.#normalizeId(parentRound.id);
		this.checkout.applyEdit(
			...Change.insertTree(
				makeRoundBuildNode(name, url, id),
				StablePlace.atEndOf({
					parent: parentNodeId,
					label: 'children' as TraitLabel,
				})
			)
		);
		return this.getRound(this.hunt.convertToStableNodeId(id));
	}

	public addRounds(
		rounds: { name: string; url: string }[],
		parentRound: Round
	): void {
		this.getRound(parentRound.id);
		this.checkout.applyEdit(
			...Change.insertTree(
				rounds.map(({ name, url }) => makeRoundBuildNode(name, url)),
				StablePlace.atEndOf({
					parent: this.#normalizeId(parentRound.id),
					label: 'children' as TraitLabel,
				})
			)
		);
	}

	public delete(puzzleObj: DocumentNode): void {
		this.checkout.applyEdit(
			Change.delete(StableRange.only(this.#normalizeId(puzzleObj.id)))
		);
	}

	public changeName(puzzleObj: DocumentNode, name: string): void {
		this.checkout.applyEdit(
			...replace(makeString(name), {
				parent: this.#normalizeId(puzzleObj.id),
				label: traitLabels.name,
			})
		);
	}

	public changeUrl(puzzleObj: DocumentNode, url: string): void {
		this.checkout.applyEdit(
			...replace(makeString(url), {
				parent: this.#normalizeId(puzzleObj.id),
				label: traitLabels.url,
			})
		);
	}

	public solve(id: string, answer: string): Puzzle {
		this.getPuzzle(id);
		const answerTraitLocation = {
			parent: this.#normalizeId(id),
			label: traitLabels.answer,
		};
		this.checkout.applyEdit(
			...replace(makeString(answer), answerTraitLocation)
		);
		return this.getPuzzle(id);
	}

	public unsolve(id: string): Puzzle {
		this.getPuzzle(id);
		this.checkout.applyEdit(
			Change.delete(
				StableRange.all({
					parent: this.#normalizeId(id),
					label: traitLabels.answer,
				})
			)
		);
		return this.getPuzzle(id);
	}

	public updateStatus(puzzle: Puzzle, status: string): void {
		this.getPuzzle(puzzle.id);
		this.checkout.applyEdit(
			...replace(makeString(status), {
				parent: this.#normalizeId(puzzle.id),
				label: traitLabels.status,
			}),
			...replace(makeNumber(Date.now()), {
				parent: this.#normalizeId(puzzle.id),
				label: traitLabels.lastStatusUpdate,
			})
		);
	}

	public clearStatus(puzzle: Puzzle): void {
		this.getPuzzle(puzzle.id);
		this.checkout.applyEdit(
			Change.delete(
				StableRange.all({
					parent: this.#normalizeId(puzzle.id),
					label: traitLabels.status,
				})
			),
			Change.delete(
				StableRange.all({
					parent: this.#normalizeId(puzzle.id),
					label: traitLabels.lastStatusUpdate,
				})
			)
		);
	}

	public move(obj: DocumentNode, newParent: Round): void {
		this.getRound(newParent.id);
		this.checkout.applyEdit(
			...Change.move(
				StableRange.only(this.#normalizeId(obj.id)),
				StablePlace.atEndOf({
					parent: this.#normalizeId(newParent.id),
					label: traitLabels.children,
				})
			)
		);
	}

	public augmentWithDiscord(
		puzzle: DocumentPuzzle,
		discordInfo: DiscordPuzzleInfo
	): void;
	public augmentWithDiscord(
		round: DocumentRound,
		discordInfo: DiscordRoundInfo
	): void;
	public augmentWithDiscord(
		obj: DocumentNode,
		discordInfo: DiscordPuzzleInfo | DiscordRoundInfo
	): void {
		const { channel, role, indexChannel } = discordInfo as DiscordRoundInfo;
		const channelId = typeof channel === 'string' ? channel : channel.id;
		const roleId = typeof role === 'string' ? role : role.id;
		const id = this.#normalizeId(obj.id);
		this.checkout.openEdit();
		this.checkout.applyChanges(
			...replace(makeString(channelId), {
				parent: id,
				label: traitLabels.channelId,
			})
		);
		this.checkout.applyChanges(
			...replace(makeString(roleId), {
				parent: id,
				label: traitLabels.roleId,
			})
		);
		if (indexChannel !== undefined) {
			const indexChannelId =
				typeof indexChannel === 'string'
					? indexChannel
					: indexChannel.id;
			this.checkout.applyChanges(
				...replace(makeString(indexChannelId), {
					parent: id,
					label: traitLabels.indexChannelId,
				})
			);
		}
		this.checkout.closeEdit();
	}

	public augmentWithGoogleSheet(
		puzzle: DocumentPuzzle,
		sheetId: string
	): void {
		this.getPuzzle(puzzle.id);
		this.checkout.applyEdit(
			...replace(makeString(sheetId), {
				parent: this.#normalizeId(puzzle.id),
				label: traitLabels.sheetId,
			})
		);
	}

	public getRound(id: string): Round {
		const nodeId = /^-?\d+$/.test(id)
			? this.#normalizeId(id)
			: this.hunt.tryConvertToNodeId(id as StableNodeId);
		const view = this.checkout.currentView;
		if (
			nodeId === undefined ||
			view.tryGetViewNode(nodeId)?.definition !== roundDef
		) {
			throw new HuntCommandError('not-found', 'Round not found.');
		}
		return new RoundHandle(view, nodeId, this.hunt);
	}

	public getPuzzle(id: string): Puzzle {
		const nodeId = /^-?\d+$/.test(id)
			? this.#normalizeId(id)
			: this.hunt.tryConvertToNodeId(id as StableNodeId);
		const view = this.checkout.currentView;
		if (
			nodeId === undefined ||
			view.tryGetViewNode(nodeId)?.definition !== puzzleDef
		) {
			throw new HuntCommandError('not-found', 'Puzzle not found.');
		}
		return new PuzzleHandle(view, nodeId, this.hunt);
	}

	public get rounds(): Iterable<Round> {
		return this.view.rounds;
	}

	public get puzzles(): Iterable<Puzzle> {
		return this.view.puzzles;
	}

	public copyFrom(other: Puzzlehunt): void {
		this.setGuildId(other.guildId);
		this.setLoggingChannelIds(other.loggingChannelIds);
		const buildNodeFromHandle = (handle: TreeNodeHandle): BuildNode => {
			const traits: {
				[key: string]:
					| BuildNode
					| TreeNodeSequence<BuildNode>
					| undefined;
			} = {};
			for (const [key, value] of Object.entries(handle.traits)) {
				traits[key] = Array.from(value, buildNodeFromHandle);
			}
			return {
				definition: handle.definition,
				payload: handle.payload,
				traits,
			};
		};
		const { currentView } = other.hunt;
		const rootHandle = new TreeNodeHandle(currentView, currentView.root);
		const roundNodes =
			rootHandle.traits['children' as TraitLabel].map(
				buildNodeFromHandle
			);

		const parentNodeId = this.hunt.convertToNodeId(initialTree.identifier);
		this.checkout.applyEdit(
			...Change.insertTree(
				roundNodes,
				StablePlace.atEndOf({
					parent: parentNodeId,
					label: 'children' as TraitLabel,
				})
			)
		);
	}
}
