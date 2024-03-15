import * as React from 'react';
import { IPuzzlehunt, Puzzle, Round } from '@belle-puzzles/puzzlehunt-model';
import { SingleInputModal } from './singleInputModal';

export interface EditUrlModalProps {
	puzzleObj: Puzzle | Round;
	puzzlehunt: IPuzzlehunt;
	close: () => void;
}

export const EditUrlModal: React.FC<EditUrlModalProps> = ({
	puzzleObj,
	puzzlehunt,
	close,
}) => {
	return (
		<SingleInputModal
			title={`Change ${puzzleObj.type} URL`}
			description={`Enter a new URL for "${puzzleObj.name}"`}
			placeholderText={`new ${puzzleObj.type} URL`}
			confirmText={'Change URL'}
			close={close}
			processInput={(input) => {
				if (!input) {
					return {
						type: 'error',
						displayMessage: 'URL must be non-empty.',
					};
				}
				try {
					new URL(input);
				} catch (e) {
					return {
						type: 'error',
						displayMessage: 'URL must be valid.',
					};
				}
				puzzlehunt.changeUrl(puzzleObj, input);
				return { type: 'success' };
			}}
		/>
	);
};
