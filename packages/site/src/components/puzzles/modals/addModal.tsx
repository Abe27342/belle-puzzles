import * as React from 'react';
import { v4 as uuid } from 'uuid';
import { Card, TextField, Button, Dialog } from '../../../fast';
import { IPuzzlehunt, Puzzle, Round } from '@belle-puzzles/puzzlehunt-model';

export interface AddModalProps {
	puzzleObj: Round | Puzzle;
	puzzlehunt: IPuzzlehunt;
	createType: 'puzzle' | 'round';
	close: () => void;
}

type PuzzleFormData = {
	name?: string;
	url?: string;
	key: string;
};

export const AddModal: React.FC<AddModalProps> = ({
	puzzleObj,
	puzzlehunt,
	createType,
	close,
}) => {
	const parent =
		puzzleObj.type === 'round'
			? puzzleObj
			: puzzlehunt.getRound(puzzleObj.roundId);

	const [puzzleData, setPuzzleData] = React.useState<PuzzleFormData[]>([
		{ key: uuid() },
	]);

	const [errorText, setErrorText] = React.useState<string | undefined>(
		undefined
	);
	React.useEffect(() => {
		if (errorText) {
			setTimeout(() => setErrorText(undefined), 5000);
		}
	}, [errorText]);

	return (
		<Dialog modal className="modal">
			<Card
				style={{ overflow: 'auto' }}
				/* prevent light-dismiss */
				onClick={(event) => event.stopPropagation()}
			>
				<h1>Add a {createType === 'puzzle' ? 'Puzzle' : 'Round'}</h1>
				<p>
					Fill out the following information to add one or more
					puzzles to "{parent.name}".
				</p>
				<div
					style={{
						display: 'grid',
						columnGap: '10px',
						rowGap: '10px',
						gridTemplateColumns: '200px 200px 200px 1fr',
					}}
				>
					<b style={{ gridColumn: 1 }}>Puzzle Name</b>
					<b style={{ gridColumn: 2 }}>Url</b>
					{...puzzleData.map(({ key, name, url }, index) => {
						const errorStyles = {
							border: '2px solid red',
							borderRadius: '5px',
						};
						return (
							<>
								<TextField
									autofocus={index === puzzleData.length}
									required={true}
									key={`add-puzzle-name-${key}`}
									style={{
										gridColumn: 1,
										...(!name && errorText
											? errorStyles
											: {}),
									}}
									onChange={(event) => {
										const content = (event.target as any)
											.value;
										setPuzzleData((data) => {
											const newData: PuzzleFormData[] =
												JSON.parse(
													JSON.stringify(data)
												);
											const elem = newData.find(
												(item) => item.key === key
											);
											elem.name = content;
											return newData;
										});
									}}
									{...(name ? { value: name } : {})}
									placeholder="name"
								/>
								<TextField
									required={true}
									key={`add-puzzle-url-${key}`}
									type={'url'}
									style={{
										gridColumn: 2,
										...(!url && errorText
											? errorStyles
											: {}),
									}}
									onChange={(event) => {
										const content = (event.target as any)
											.value;
										setPuzzleData((data) => {
											const newData: PuzzleFormData[] =
												JSON.parse(
													JSON.stringify(data)
												);
											const elem = newData.find(
												(item) => item.key === key
											);
											elem.url = content;
											return newData;
										});
									}}
									placeholder="url"
									{...(url ? { value: url } : {})}
								/>
								{puzzleData.length > 1 && (
									<Button
										key={`delete-${key}`}
										style={{ gridColumn: 3, width: '30px' }}
										onClick={() => {
											setPuzzleData((data) => {
												const newData = JSON.parse(
													JSON.stringify(data)
												).filter(
													(item: any) =>
														item.key !== key
												);
												return newData;
											});
										}}
									>
										-
									</Button>
								)}
							</>
						);
					})}
					<Button
						key={'add-more-puzzles'}
						style={{ gridColumn: 3, width: '30px' }}
						onClick={() => {
							setPuzzleData((data) => [...data, { key: uuid() }]);
						}}
					>
						+
					</Button>
					<Button
						appearance={'neutral'}
						style={{
							gridColumn: 1,
							gridRow: Math.max(5, puzzleData.length + 3),
						}}
						onClick={close}
					>
						Cancel
					</Button>
					<Button
						appearance={'accent'}
						style={{
							gridColumn: 3,
							gridRow: Math.max(5, puzzleData.length + 3),
						}}
						onClick={() => {
							const validatedData: {
								name: string;
								url: string;
							}[] = [];
							for (const { name, url } of puzzleData) {
								if (!name || !url) {
									setErrorText('All fields must be filled.');
									return;
								}
								validatedData.push({ name, url });
							}

							if (createType === 'puzzle') {
								puzzlehunt.addPuzzles(validatedData, parent);
							} else {
								puzzlehunt.addRounds(validatedData, parent);
							}
							close();
						}}
					>
						Add {`${createType}${puzzleData.length > 1 ? 's' : ''}`}
					</Button>
					{errorText && <p style={{ gridColumn: 3 }}>{errorText}</p>}
				</div>
			</Card>
		</Dialog>
	);
};
