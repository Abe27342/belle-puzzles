# @belle-puzzles/puzzlehunt-model

This package hosts the document model for a puzzlehunt.

Two implementations are available:

-   An implementation backed by Fluid's experimental SharedTree, generally available via `@belle-puzzles/puzzlehunt-model/fluid`
-   An implementation backed by postgres, generally available via `@belle-puzzles/puzzlehunt-model/postgres`

The latter is currently a work in progress, as there were some leaky Fluid abstractions.
The Fluid backed implementation is in the process of being retired, as Azure Fluid Relay is being sunsetted and this project's actual technical requirements do not particularly warrant using Fluid if that additionally involves the burden of running an ordering service.
See [this Github issue](https://github.com/Abe27342/belle-puzzles/issues/44) for status and relevant details.

## Creating and selecting persisted hunts

`HuntCollectionClient` (from the `/document` entry point) provides guild-level
operations separate from an already-loaded `IPuzzlehuntModel`.
`PostgresPuzzlehuntStore` (from `/postgres`) and `HttpHuntDocumentClient` (from
`/http`) implement both this capability and the existing document client:

```ts
const created = await client.create(guildId, {
	name: 'Next hunt',
	configuration: { googleFolderId: 'existing-folder-id' }, // optional
});
const model = new PuzzlehuntModel(client, created);
const listing = await client.list(guildId);
const previous = listing.hunts.find((hunt) => !hunt.active);
if (previous) {
	await client.selectActive({ guildId: listing.guildId, huntId: previous.huntId });
}
```

Creation atomically persists an empty, revision-zero hunt and selects it for the
guild. Configuration uses the common `HuntConfiguration` schema; creation does not
provision Discord channels, roles, or Google Drive resources. Listing returns
`{ guildId, hunts: [{ huntId, name, active }] }`, including inactive hunts.
Selecting a hunt validates guild ownership and changes only the active pointer.
Previous documents, revisions, command receipts, and integration work remain
stored. Existing models continue reading and editing their original hunt;
selection does not retarget open models. Use `readActive(guildId)` to resolve the
current selection and `PuzzlehuntModel.load(client, scope)` to reopen any listed hunt.

The PostgreSQL store assumes an initialized schema and caller-authorized guild
access. The HTTP client uses the service's existing Bearer/Service authorization.
Neither adapter automatically retries creation: an uncertain response may have
committed an additional hunt. List hunts and inspect the active selection before
retrying manually. Creation has no idempotency key, and these APIs do not delete
hunts.

## Testing

Models are tested using contract-based tests running against local databases/services.
This means using azure-local-server for the Fluid backed implementation, and a disposable native PostgreSQL service for the postgres model implementation.
