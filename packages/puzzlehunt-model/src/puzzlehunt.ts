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
import { TypedEventEmitter } from '@fluidframework/common-utils';
import { IEvent } from '@fluidframework/common-definitions';

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

export interface IPuzzlehuntEvents extends IEvent {
	(
		event: 'viewChange',
		listener: (before: TreeView, after: TreeView) => void
	): void;
}

export interface DiscordPuzzleInfo {
	channel: { /* channel ID */ id: string } | string;
	role: { /* role ID */ id: string } | string;
}

export interface DiscordRoundInfo extends DiscordPuzzleInfo {
	indexChannel: { /* channel ID */ id: string } | string;
}

export interface IPuzzlehunt extends TypedEventEmitter<IPuzzlehuntEvents> {
	addPuzzle(name: string, url: string, round: Round): Puzzle;
	addPuzzles(puzzles: { name: string; url: string }[], round: Round): void;
	delete(puzzleObj: Puzzle | Round): void;
	changeName(puzzleObj: Puzzle | Round, name: string): void;
	changeUrl(puzzleObj: Puzzle | Round, url: string): void;
	addRound(name: string, url: string, parentRound?: Round): Round;
	addRounds(
		rounds: { name: string; url: string }[],
		parentRound: Round
	): void;
	solve(id: NodeId, answer: string): Puzzle;
	updateStatus(puzzle: Puzzle, status: string): void;
	clearStatus(puzzle: Puzzle): void;
	move(obj: Puzzle | Round, newParent: Round): void;
	augmentWithDiscord(puzzle: Puzzle, discordInfo: DiscordPuzzleInfo): void;
	augmentWithDiscord(round: Round, discordInfo: DiscordRoundInfo): void;
	augmentWithGoogleSheet(puzzle: Puzzle, sheetId: string): void;
	getRound(id: NodeId): Round;
	getPuzzle(id: NodeId): Puzzle;
	get rounds(): Iterable<Round>;
	get puzzles(): Iterable<Puzzle>;
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

export interface StringNode {
	type: 'string';
	value: string;
	parentage: TraitLocation;
}

export interface NumberNode {
	type: 'number';
	value: number;
	parentage: TraitLocation;
}

export interface Puzzle extends Omit<PuzzleObject, 'roundId'> {
	type: 'puzzle';
	roundId: NodeId;
	// color: string;
	// Google drive id
	sheetId?: string;
	answer?: string;
	status?: string;
	// Note: client-side timestamp. It would be great to leverage platform-provided attribution for this prop.
	lastStatusUpdate?: number;
}

export interface Round extends PuzzleObject {
	type: 'round';
	children: (Round | Puzzle)[];
	// color: string;
	// idxMsgId: string; used in previous version to update discord stuff
}

export interface DiscordAssociation {
	channelId: string;
	// Only populated for rounds
	indexChannelId?: string;
	roleId: string;
}

export interface PuzzleObject {
	id: NodeId;
	name: string;
	url: string;
	discordInfo?: DiscordAssociation;
	roundId?: NodeId; // undefined means root
}

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

class RoundHandle implements Round {
	private readonly handle: TreeNodeHandle;
	private readonly traits: TraitMap<TreeNodeHandle>;
	public readonly type = 'round';
	constructor(private readonly view: TreeView, public readonly id: NodeId) {
		this.handle = new TreeNodeHandle(view, id);
		this.traits = this.handle.traits;
	}

	public get name(): string {
		return str(readCell(this.traits.name).payload);
	}
	public get url(): string {
		return str(readCell(this.traits.url).payload);
	}

	public get discordInfo(): DiscordAssociation | undefined {
		const roleIdNode = readOptional(this.traits.roleId);
		const channelIdNode = readOptional(this.traits.channelId);
		const indexChannelIdNode = readOptional(this.traits.indexChannelId);
		if (roleIdNode && channelIdNode && indexChannelIdNode) {
			return {
				roleId: str(roleIdNode.payload),
				channelId: str(channelIdNode.payload),
				indexChannelId: str(indexChannelIdNode.payload),
			};
		}
		return undefined;
	}

	public get roundId(): NodeId | undefined {
		const parentId = this.handle.node.parentage.parent;
		const grandparent = this.view.tryGetParentViewNode(parentId);
		// grandparent === undefined implies parent is the root node. So this round has no parent.
		return grandparent === undefined ? undefined : parentId;
	}

	public get children(): (Puzzle | Round)[] {
		return Array.from(
			this.handle.node.traits.get(traitLabels.children) ?? [],
			(childId) => {
				const childHandle = getHandle(this.view, childId);
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

class PuzzleHandle implements Puzzle {
	private readonly handle: TreeNodeHandle;
	private readonly traits: TraitMap<TreeNodeHandle>;
	public readonly type = 'puzzle';
	constructor(view: TreeView, public readonly id: NodeId) {
		this.handle = new TreeNodeHandle(view, id);
		this.traits = this.handle.traits;
	}

	public get name(): string {
		return str(readCell(this.traits.name).payload);
	}
	public get url(): string {
		return str(readCell(this.traits.url).payload);
	}

	public get discordInfo(): DiscordAssociation | undefined {
		const roleIdNode = readOptional(this.traits.roleId);
		const channelIdNode = readOptional(this.traits.channelId);
		if (roleIdNode && channelIdNode) {
			return {
				roleId: str(roleIdNode.payload),
				channelId: str(channelIdNode.payload),
			};
		}
		return undefined;
	}

	public get roundId(): NodeId {
		return this.handle.node.parentage.parent;
	}

	public get sheetId(): string | undefined {
		return readOptional(this.traits.sheetId)?.payload;
	}

	public get answer(): string | undefined {
		return readOptional(this.traits.answer)?.payload;
	}

	public get status(): string | undefined {
		return readOptional(this.traits.status)?.payload;
	}

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
	id: NodeId
): Puzzle | Round | StringHandle | NumberNode | undefined => {
	const viewNode = view.getViewNode(id);
	switch (viewNode.definition) {
		case roundDef:
			return new RoundHandle(view, id);
		case puzzleDef:
			return new PuzzleHandle(view, id);
		case stringDef:
			return new StringHandle(view, id);
		case numberDef:
			return new NumberHandle(view, id);
	}
};

class Puzzlehunt
	extends TypedEventEmitter<IPuzzlehuntEvents>
	implements IPuzzlehunt
{
	private readonly hunt: SharedTree;
	private readonly checkout: EagerCheckout;
	private readonly guildInfoMap: SharedMap;

	constructor(container: IFluidContainer) {
		super();
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
			this.emit('viewChange', before, after, getHandle);
		});
		this.guildInfoMap = guildInfo;
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
		const id = this.hunt.generateNodeId();
		this.checkout.applyEdit(
			...Change.insertTree(
				makePuzzleBuildNode(name, url, id),
				StablePlace.atEndOf({
					parent: round.id,
					label: 'children' as TraitLabel,
				})
			)
		);
		return new PuzzleHandle(this.checkout.currentView, id);
	}

	public addPuzzles(
		puzzles: { name: string; url: string }[],
		round: Round
	): void {
		this.checkout.applyEdit(
			...Change.insertTree(
				puzzles.map(({ name, url }) => makePuzzleBuildNode(name, url)),
				StablePlace.atEndOf({
					parent: round.id,
					label: 'children' as TraitLabel,
				})
			)
		);
	}

	public addRound(name: string, url: string, parentRound?: Round): Round {
		const id = this.hunt.generateNodeId();
		const parentNodeId =
			parentRound?.id ??
			this.hunt.convertToNodeId(initialTree.identifier);
		this.checkout.applyEdit(
			...Change.insertTree(
				makeRoundBuildNode(name, url, id),
				StablePlace.atEndOf({
					parent: parentNodeId,
					label: 'children' as TraitLabel,
				})
			)
		);
		return new RoundHandle(this.checkout.currentView, id);
	}

	public addRounds(
		rounds: { name: string; url: string }[],
		parentRound: Round
	): void {
		this.checkout.applyEdit(
			...Change.insertTree(
				rounds.map(({ name, url }) => makeRoundBuildNode(name, url)),
				StablePlace.atEndOf({
					parent: parentRound.id,
					label: 'children' as TraitLabel,
				})
			)
		);
	}

	public delete(puzzleObj: Puzzle | Round): void {
		this.checkout.applyEdit(Change.delete(StableRange.only(puzzleObj.id)));
	}

	public changeName(puzzleObj: Puzzle | Round, name: string): void {
		this.checkout.applyEdit(
			...replace(makeString(name), {
				parent: puzzleObj.id,
				label: traitLabels.name,
			})
		);
	}

	public changeUrl(puzzleObj: Puzzle | Round, url: string): void {
		this.checkout.applyEdit(
			...replace(makeString(url), {
				parent: puzzleObj.id,
				label: traitLabels.url,
			})
		);
	}

	public solve(id: NodeId, answer: string): Puzzle {
		const answerTraitLocation = { parent: id, label: traitLabels.answer };
		this.checkout.applyEdit(
			...replace(makeString(answer), answerTraitLocation)
		);
		return new PuzzleHandle(this.checkout.currentView, id);
	}

	public updateStatus(puzzle: Puzzle, status: string): void {
		this.checkout.applyEdit(
			...replace(makeString(status), {
				parent: puzzle.id,
				label: traitLabels.status,
			}),
			...replace(makeNumber(Date.now()), {
				parent: puzzle.id,
				label: traitLabels.lastStatusUpdate,
			})
		);
	}

	public clearStatus(puzzle: Puzzle): void {
		this.checkout.applyEdit(
			Change.delete(
				StableRange.all({
					parent: puzzle.id,
					label: traitLabels.status,
				})
			),
			Change.delete(
				StableRange.all({
					parent: puzzle.id,
					label: traitLabels.lastStatusUpdate,
				})
			)
		);
	}

	public move(obj: Puzzle | Round, newParent: Round): void {
		this.checkout.applyEdit(
			...Change.move(
				StableRange.only(obj.id),
				StablePlace.atEndOf({
					parent: newParent.id,
					label: traitLabels.children,
				})
			)
		);
	}

	public augmentWithDiscord(
		puzzle: Puzzle,
		discordInfo: DiscordPuzzleInfo
	): void;
	public augmentWithDiscord(
		round: Round,
		discordInfo: DiscordRoundInfo
	): void;
	public augmentWithDiscord(
		obj: Puzzle | Round,
		discordInfo: DiscordPuzzleInfo | DiscordRoundInfo
	): void {
		const { channel, role, indexChannel } = discordInfo as DiscordRoundInfo;
		const channelId = typeof channel === 'string' ? channel : channel.id;
		const roleId = typeof role === 'string' ? role : role.id;
		this.checkout.openEdit();
		this.checkout.applyChanges(
			...replace(makeString(channelId), {
				parent: obj.id,
				label: traitLabels.channelId,
			})
		);
		this.checkout.applyChanges(
			...replace(makeString(roleId), {
				parent: obj.id,
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
					parent: obj.id,
					label: traitLabels.indexChannelId,
				})
			);
		}
		this.checkout.closeEdit();
	}

	public augmentWithGoogleSheet(puzzle: Puzzle, sheetId: string): void {
		this.checkout.applyEdit(
			...replace(makeString(sheetId), {
				parent: puzzle.id,
				label: traitLabels.sheetId,
			})
		);
	}

	public getRound(id: NodeId): Round {
		return new RoundHandle(this.checkout.currentView, id);
	}

	public getPuzzle(id: NodeId): Puzzle {
		return new PuzzleHandle(this.checkout.currentView, id);
	}

	public get rounds(): Iterable<Round> {
		return Array.from(
			this.getAllDefsMatching(this.checkout.currentView.root, roundDef),
			(id) => new RoundHandle(this.checkout.currentView, id)
		);
	}

	public get puzzles(): Iterable<Puzzle> {
		return Array.from(
			this.getAllDefsMatching(this.checkout.currentView.root, puzzleDef),
			(id) => new PuzzleHandle(this.checkout.currentView, id)
		);
	}

	private *getAllDefsMatching(id: NodeId, def: string): Iterable<NodeId> {
		const viewNode = this.checkout.currentView.getViewNode(id);
		if (viewNode.definition === def) {
			yield viewNode.identifier;
		}
		for (const child of viewNode.traits.get(traitLabels.children) ?? []) {
			yield* this.getAllDefsMatching(child, def);
		}
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
