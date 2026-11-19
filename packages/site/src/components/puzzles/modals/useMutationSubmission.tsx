import * as React from 'react';
import type { PuzzlehuntModel } from '@belle-puzzles/puzzlehunt-model/model';
import { errorMessage } from '../usePuzzlehunt';
import { Button } from '../../../fast';
import type { InputResult } from './singleInputModal';

/**
 * Optional HTTP settlement boundary shared by mutation dialogs.
 *
 * @remarks
 * Mutations stay synchronous and optimistic, but HTTP dialogs await flush before
 * closing. Definite rejections roll back; uncertain outcomes retain the model's
 * original queue and command IDs. Retry calls retryPending instead of rerunning
 * the mutation or using the generic fetch retry wrapper. Direct sheet-ID edits
 * remain user commands, not worker operations. Without this context, Fluid
 * dialogs preserve their synchronous submission behavior.
 */
export interface MutationSettlement {
	model: PuzzlehuntModel;
	isCurrent(): boolean;
	canEdit(): boolean;
}

export const MutationSettlementContext = React.createContext<
	MutationSettlement | undefined
>(undefined);

export function useMutationSubmission(close: () => void) {
	const settlement = React.useContext(MutationSettlementContext);
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string>();
	const running = React.useRef(false);
	const active = React.useRef(true);
	React.useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);

	const run = async (mutation?: () => InputResult | void) => {
		if (
			running.current ||
			!active.current ||
			(settlement && !settlement.isCurrent())
		)
			return;
		if (
			mutation &&
			settlement &&
			(!settlement.canEdit() || settlement.model.isPending)
		)
			return;
		running.current = true;
		setBusy(true);
		setError(undefined);
		try {
			if (mutation) {
				settlement?.model.clearFailures();
				const result = mutation();
				if (result && result.type === 'error') {
					return;
				}
				if (settlement) await settlement.model.flush();
			} else {
				await settlement.model.retryPending();
			}
			if (active.current && (!settlement || settlement.isCurrent()))
				close();
		} catch (error) {
			if (active.current && (!settlement || settlement.isCurrent())) {
				setError(
					settlement?.model.isPending
						? `Save outcome uncertain. Retry the pending edit; do not submit it again. ${errorMessage(
								error
						  )}`
						: `Save rejected. ${errorMessage(error)}`
				);
			}
		} finally {
			running.current = false;
			if (active.current) setBusy(false);
		}
	};
	const pending = settlement?.model.isPending ?? false;
	const uncertain =
		settlement?.model.pendingChanges.some(
			(change) => change.status === 'uncertain'
		) ?? false;
	return {
		submit: (mutation: () => InputResult | void) => void run(mutation),
		disabled: busy || pending || (settlement && !settlement.canEdit()),
		dismissDisabled: busy || pending,
		dialogHeight: settlement ? 'min(480px, 80vh)' : undefined,
		status: (busy || error || uncertain) && (
			<div style={{ gridColumn: '1 / -1', paddingBottom: '40px' }}>
				{busy && <p role="status">Saving...</p>}
				{error && <p role="alert">{error}</p>}
				{uncertain && (
					<Button disabled={busy} onClick={() => void run()}>
						Retry pending edit
					</Button>
				)}
			</div>
		),
	};
}
