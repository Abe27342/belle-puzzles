import * as React from 'react';
import { IPuzzlehunt, Puzzle } from '@belle-puzzles/puzzlehunt-model';
import { SingleInputModal } from './singleInputModal';

export interface EditSheetIdModalProps {
	puzzleObj: Puzzle;
	puzzlehunt: IPuzzlehunt;
	close: () => void;
}

export const EditSheetIdModal: React.FC<EditSheetIdModalProps> = ({
	puzzleObj,
	puzzlehunt,
	close,
}) => {
	return (
		<SingleInputModal
			title={'Change Sheet ID'}
			description={`Enter a new google sheet ID for "${puzzleObj.name}"`}
			placeholderText={`new ${puzzleObj.type} sheet ID`}
			confirmText={'Change Sheet ID'}
			close={close}
			processInput={(input) => {
				if (!input) {
					return {
						type: 'error',
						displayMessage: 'Sheet ID must be filled.',
					};
				}

				puzzlehunt.augmentWithGoogleSheet(puzzleObj, input);
				return { type: 'success' };
			}}
		/>
	);
};
