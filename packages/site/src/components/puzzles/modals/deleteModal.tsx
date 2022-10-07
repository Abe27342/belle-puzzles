import * as React from 'react';
import { Card, Button, Dialog } from '../../../fast';
import { IPuzzlehunt, Puzzle, Round } from '@belle-puzzles/puzzlehunt-model';

export interface DeleteModalProps {
	puzzleObj: Round | Puzzle;
	puzzlehunt: IPuzzlehunt;
	close: () => void;
}

export const DeleteModal: React.FC<DeleteModalProps> = ({
	puzzleObj,
	puzzlehunt,
	close,
}) => {
	return (
		<Dialog
			modal
			className="modal"
			style={
				{
					'--dialog-width': '480px',
					'--dialog-height': '240px',
				} as any /* these are custom properties on fast components */
			}
		>
			<Card
				style={{ overflow: 'auto' }}
				/* prevent light-dismiss */
				onClick={(event) => event.stopPropagation()}
			>
				<h1>Delete "{puzzleObj.name}"</h1>
				<p>Are you sure you want to delete this {puzzleObj.type}?</p>
				<Button
					appearance={'neutral'}
					style={{
						position: 'fixed',
						bottom: 'var(--card-padding)',
						left: 'var(--card-padding)',
					}}
					onClick={close}
				>
					Cancel
				</Button>
				<Button
					appearance={'accent'}
					style={{
						position: 'fixed',
						bottom: 'var(--card-padding)',
						right: 'var(--card-padding)',
					}}
					onClick={() => {
						puzzlehunt.delete(puzzleObj);
						close();
					}}
				>
					Delete
				</Button>
			</Card>
		</Dialog>
	);
};
