import {
	loadExistingPuzzlehunt,
	snapshotPuzzlehunt,
} from '@belle-puzzles/puzzlehunt-model';
import { RouterliciousDocumentServiceFactory } from '@fluidframework/routerlicious-driver';
import {
	makeFluidClient,
	makeReadOnlyFluidConnection,
} from '../fluid/client.js';
import type { LoadedSnapshot } from './exporter.js';

export async function loadSnapshot(
	documentId: string,
	timeoutMs = 120_000
): Promise<LoadedSnapshot> {
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			controller.abort();
			reject(
				new Error(
					`Loading/catching up document timed out after ${timeoutMs}ms.`
				)
			);
		}, timeoutMs);
	});
	const loading = loadExistingPuzzlehunt(
		makeFluidClient({ readOnly: true }),
		documentId,
		{
			signal: controller.signal,
			catchUp: async (container) => {
				if (container.resolvedUrl === undefined) {
					throw new Error(
						'The loaded document has no resolved source URL.'
					);
				}
				const connection = makeReadOnlyFluidConnection();
				const remote = connection.type === 'remote';
				const factory = new RouterliciousDocumentServiceFactory(
					connection.tokenProvider,
					{
						enableWholeSummaryUpload: remote,
						enableDiscovery: remote,
					}
				);
				const service = await factory.createDocumentService(
					container.resolvedUrl
				);
				try {
					// The old catch-up helper can return before storage prefetch
					// finishes on read connections without a checkpoint. Establish
					// a durable op fence without submitting an op to the document.
					const delta = container.deltaManager;
					let target = delta.lastSequenceNumber;
					const storage = await service.connectToDeltaStorage();
					const stream = storage.fetchMessages(
						target + 1,
						undefined,
						controller.signal,
						false,
						'belle-export'
					);
					while (true) {
						const batch = await stream.read();
						if (batch.done === true) {
							break;
						}
						for (const op of batch.value) {
							target = Math.max(target, op.sequenceNumber);
						}
					}
					await new Promise<void>((resolve, reject) => {
						const cleanup = () => {
							delta.off('op', check);
							container.off('closed', closed);
						};
						const closed = () => {
							cleanup();
							reject(
								new Error(
									'Document closed before reaching the export op fence.'
								)
							);
						};
						const check = () => {
							if (container.closed) {
								closed();
							} else if (delta.lastSequenceNumber >= target) {
								cleanup();
								resolve();
							}
						};
						delta.on('op', check);
						container.on('closed', closed);
						check();
					});
				} finally {
					service.dispose();
				}
			},
		}
	).then(({ puzzlehunt, container, disposer }) => {
		try {
			controller.signal.throwIfAborted();
			if (container.disposed) {
				throw new Error(
					'Document was disposed before snapshot capture.'
				);
			}
			const state = snapshotPuzzlehunt(puzzlehunt);
			if (container.isDirty) {
				throw new Error(
					'Read-only export unexpectedly dirtied the Fluid container.'
				);
			}
			return { capturedAt: new Date().toISOString(), state };
		} finally {
			disposer.dispose();
		}
	});
	try {
		return await Promise.race([loading, timeout]);
	} finally {
		clearTimeout(timer);
	}
}
