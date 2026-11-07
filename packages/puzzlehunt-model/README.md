# @belle-puzzles/puzzlehunt-model

This package hosts the document model for a puzzlehunt.

Two implementations are available:

-   An implementation backed by Fluid's experimental SharedTree, generally available via `@belle-puzzles/puzzlehunt-model/fluid`
-   An implementation backed by postgres, generally available via `@belle-puzzles/puzzlehunt-model/postgres`

The latter is currently a work in progress, as there were some leaky Fluid abstractions.
The Fluid backed implementation is in the process of being retired, as Azure Fluid Relay is being sunsetted and this project's actual technical requirements do not particularly warrant using Fluid if that additionally involves the burden of running an ordering service.
See [this Github issue](https://github.com/Abe27342/belle-puzzles/issues/44) for status and relevant details.

## Testing

Models are tested using contract-based tests running against local databases/services.
This means using azure-local-server for the Fluid backed implementation, and a local database backed by \@electric-sql/pglite for the postgres model implementation.
