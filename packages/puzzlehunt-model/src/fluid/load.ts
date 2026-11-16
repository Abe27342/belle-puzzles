import { SharedTree, WriteFormat } from '@fluid-experimental/tree';
import { SharedMap } from 'fluid-framework';
import { waitContainerToCatchUp } from '@fluidframework/container-loader';
import { AzureClient } from '@fluidframework/azure-client';
import { IFluidContainer } from '@fluidframework/fluid-static';
import type { IPuzzlehunt, LoggingChannelIds } from '../model/types.js';
import { Puzzlehunt } from '../puzzlehunt.js';

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
