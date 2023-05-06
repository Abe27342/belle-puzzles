import * as React from 'react';
import { Card, Button, Dialog, TextField } from '../../../fast';
import { IPuzzlehunt, Puzzle, Round } from '@belle-puzzles/puzzlehunt-model';

export interface EditNameModalProps {
	puzzleObj: Round | Puzzle;
	puzzlehunt: IPuzzlehunt;
	close: () => void;
}

export const SolveModal: React.FC<EditNameModalProps> = ({
	puzzleObj,
	puzzlehunt,
	close,
}) => {
	const [errorText, setErrorText] = React.useState<string | undefined>(
		undefined
	);
	const [content, setContent] = React.useState<string | undefined>(undefined);

	React.useEffect(() => {
		if (errorText) {
			setTimeout(() => setErrorText(undefined), 5000);
		}
	}, [errorText]);
	const errorStyles = {
		border: '2px solid red',
		borderRadius: '5px',
	};

	return (
		<Dialog
			modal
			className="modal"
			style={
				{
					'--dialog-width': '480px',
					'--dialog-height': '320px',
				} as any /* these are custom properties on fast components */
			}
		>
			<Card
				style={{ overflow: 'auto' }}
				/* prevent light-dismiss */
				onClick={(event) => event.stopPropagation()}
			>
				<h1>Solve Puzzle</h1>
				<p>Solve "{puzzleObj.name}"</p>
				<TextField
					required={true}
					style={{
						...(!content && errorText ? errorStyles : {}),
					}}
					onChange={(event) => {
						const content = (event.target as any).value;
						setContent(content);
					}}
					placeholder={'Answer'}
					{...(content ? { value: content } : {})}
				/>
				{errorText && (
					<p
						style={{
							position: 'fixed',
							bottom: 'calc(var(--card-padding) + 25px)',
							right: 'var(--card-padding)',
						}}
					>
						{errorText}
					</p>
				)}
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
						if (!content) {
							setErrorText('Name must be filled.');
							return;
						}
						puzzlehunt.solve(puzzleObj.id, content);
						close();
					}}
				>
					Solve puzzle
				</Button>
			</Card>
		</Dialog>
	);
};
