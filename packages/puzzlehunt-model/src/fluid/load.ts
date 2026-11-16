import { SharedTree, WriteFormat } from '@fluid-experimental/tree';
import { SharedMap } from 'fluid-framework';
import type { AzureClient } from '@fluidframework/azure-client';
import type { IFluidContainer } from '@fluidframework/fluid-static';
import { waitContainerToCatchUp } from '@fluidframework/container-loader';
import type {
	IPuzzlehunt,
	IPuzzlehuntSession,
	LoggingChannelIds,
} from '../model/types.js';
import { Puzzlehunt } from '../puzzlehunt.js';
import { FluidPuzzlehuntSession } from './model.js';

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

const nativeHunts = new WeakMap<IPuzzlehunt, Puzzlehunt>();

export const createNewPuzzlehunt = async (
	client: AzureClient,
	guildId: string,
	logChannelIds?: LoggingChannelIds
): Promise<IPuzzlehuntSession> =>
	createPuzzlehunt(client, (hunt) => {
		hunt.setGuildId(guildId);
		if (logChannelIds) {
			hunt.setLoggingChannelIds(logChannelIds);
		}
	});

/** Copying deliberately requires the native Fluid implementation. */
export async function createNewPuzzlehuntFromExisting(
	client: AzureClient,
	existingHunt: IPuzzlehunt
): Promise<IPuzzlehuntSession> {
	const native = nativeHunts.get(existingHunt) ?? existingHunt;
	if (!(native instanceof Puzzlehunt)) {
		throw new Error(
			'This API relies on internals of the tree-based Puzzlehunt implementation.'
		);
	}
	return createPuzzlehunt(client, (hunt) => hunt.copyFrom(native));
}

async function createPuzzlehunt(
	client: AzureClient,
	editBeforeAttach: (puzzlehunt: Puzzlehunt) => void
): Promise<IPuzzlehuntSession> {
	const { container } = await client.createContainer(schema);
	try {
		// May want to initialize state here.
		const hunt = new Puzzlehunt(container);
		let unsubscribeErrors = () => {};
		const failure = new Promise<never>((_, reject) => {
			unsubscribeErrors = hunt.subscribeErrors(reject);
		});
		let id: string;
		try {
			id = await Promise.race([
				failure,
				Promise.resolve().then(() => {
					editBeforeAttach(hunt);
					return container.attach();
				}),
			]);
		} finally {
			unsubscribeErrors();
		}
		const session = new FluidPuzzlehuntSession(hunt, container, id);
		assertOpen(session);
		nativeHunts.set(session.puzzlehunt, hunt);
		return session;
	} catch (error) {
		container.dispose();
		throw error;
	}
}

export const loadExistingPuzzlehunt = async (
	client: AzureClient,
	id: string
): Promise<IPuzzlehuntSession> => {
	const { container } = await client.getContainer(id, schema);
	try {
		// Fluid 1.x only exposes catch-up on the underlying loader container.
		const { container: loaderContainer } = container as IFluidContainer & {
			readonly container: Parameters<typeof waitContainerToCatchUp>[0];
		};
		await waitContainerToCatchUp(loaderContainer);
		const hunt = new Puzzlehunt(container);
		const session = new FluidPuzzlehuntSession(hunt, container, id);
		assertOpen(session);
		nativeHunts.set(session.puzzlehunt, hunt);
		return session;
	} catch (error) {
		container.dispose();
		throw error;
	}
};

function assertOpen(session: IPuzzlehuntSession): void {
	if (session.state.status === 'failed') {
		throw session.state.error;
	}
	if (session.state.status !== 'open') {
		throw new Error('Puzzlehunt closed while loading.');
	}
}
