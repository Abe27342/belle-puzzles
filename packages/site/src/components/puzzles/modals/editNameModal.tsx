import * as React from 'react';
import { IPuzzlehunt, Puzzle, Round } from '@belle-puzzles/puzzlehunt-model';
import { SingleInputModal } from './singleInputModal';

export interface EditNameModalProps {
	puzzleObj: Round | Puzzle;
	puzzlehunt: IPuzzlehunt;
	close: () => void;
}

export const EditNameModal: React.FC<EditNameModalProps> = ({
	puzzleObj,
	puzzlehunt,
	close,
}) => {
	return (
		<SingleInputModal
			title={'Change Name'}
			description={`Enter a new name for "${puzzleObj.name}"`}
			placeholderText={`new ${puzzleObj.type} name`}
			confirmText={'Change Name'}
			close={close}
			processInput={(input) => {
				if (!input) {
					return {
						type: 'error',
						displayMessage: 'Name must be filled.',
					};
				}

				puzzlehunt.changeName(puzzleObj, input);
				return { type: 'success' };
			}}
		/>
	);
};
