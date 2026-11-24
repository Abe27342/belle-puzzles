import * as React from 'react';
import '../css/puzzles.css';
import { useParams } from 'react-router-dom';
import {
	Anchor,
	TreeItem,
	Skeleton,
	TreeView,
	Card,
	Toolbar,
	Menu,
	MenuItem,
	Button,
} from '../../fast';
import { IPuzzlehunt, Puzzle, Round } from '@belle-puzzles/puzzlehunt-model';
import type { PuzzlehuntModel } from '@belle-puzzles/puzzlehunt-model/model';
import {
	AddModal,
	DeleteModal,
	EditNameModal,
	EditSheetIdModal,
	EditUrlModal,
} from './modals';
import { errorMessage, usePuzzlehunt } from './usePuzzlehunt';
import { MutationSettlementContext } from './modals/useMutationSubmission';
import TimeAgo from './timeAgo';
import loadingPuzzlehuntUrl from './assets/loading-puzzlehunt.svg';
import libraLogoUrl from './assets/libralogo.png';
import { SolveModal } from './modals/solveModal';

export const Puzzles: React.FC = () => {
	const { guildId } = useParams() as { guildId: string };
	const hunt = usePuzzlehunt(guildId);
	const puzzlehunt = hunt.loaded?.model;
	const http = hunt.loaded?.backend === 'postgres' ? hunt.loaded : undefined;
	const descriptor = hunt.loaded?.descriptor;
	const name = descriptor?.name;
	const googleFolderId =
		descriptor?.backend === 'postgres'
			? descriptor.configuration.googleFolderId
			: descriptor?.googleFolderId;
	const uncertain = http?.model.pendingChanges.some(
		(change) => change.status === 'uncertain'
	);
	const failure = http?.model.failures.at(-1);
	const settlement = http && {
		model: http.model,
		isCurrent: () => hunt.isCurrent() && http.isActive(),
		canEdit: () =>
			hunt.isCurrent() &&
			http.isActive() &&
			hunt.metadataVerified &&
			!http.model.isPending &&
			!hunt.busy &&
			!hunt.selected &&
			!hunt.error,
	};

	const [sortByStatus, setSortByStatus] = React.useState(false);

	const rounds = Array.from(puzzlehunt?.rounds ?? []);
	rounds.sort((a, b) => a.name.localeCompare(b.name));
	const { onContextMenu, ui } = useEditingUI(puzzlehunt, http?.model);
	return (
		<MutationSettlementContext.Provider value={settlement}>
			<div id="puzzles" className="page-body">
				<Card>
					<img id="libralogo" src={libraLogoUrl} />
					{!puzzlehunt && !hunt.error && <LoadingSkeleton />}
					{hunt.error && (
						<div role="alert">
							{hunt.error}
							<Button
								disabled={hunt.busy || http?.model.isPending}
								onClick={hunt.refresh}
							>
								Refresh
							</Button>
						</div>
					)}
					{hunt.navigationBlocked && (
						<p role="alert">
							Settle pending edits before leaving this hunt or
							logging out. Retry uncertain edits below, then
							navigate again.
						</p>
					)}
					{hunt.selected && (
						<p role="alert">
							The active hunt has changed. This view still shows
							the original hunt; pending edits stay with it.
							<Button
								disabled={hunt.busy || http?.model.isPending}
								onClick={hunt.reopen}
							>
								Open selected hunt
							</Button>
						</p>
					)}
					{http && (
						<>
							<p>
								This is a non-live view. Refresh to see other
								edits and newly provisioned Discord or Google
								resources.
							</p>
							{!hunt.metadataVerified &&
								!hunt.busy &&
								!hunt.selected && (
									<p>
										After settling pending edits, refresh to
										verify the selected hunt before making
										further edits.
									</p>
								)}
							<Button
								disabled={hunt.busy || http.model.isPending}
								onClick={hunt.refresh}
							>
								Refresh hunt
							</Button>
							{http.model.isPending && (
								<p role={uncertain ? 'alert' : 'status'}>
									{uncertain
										? 'Save outcome uncertain. Keep this tab open and retry the retained edits; do not submit them again.'
										: 'Saving edits...'}
								</p>
							)}
							{uncertain && !ui && (
								<Button
									disabled={hunt.busy}
									onClick={hunt.retry}
								>
									Retry pending edits
								</Button>
							)}
							{failure && (
								<p role="alert">
									{failure.request
										? 'Save rejected: '
										: 'Refresh failed: '}
									{errorMessage(failure.error)}
								</p>
							)}
						</>
					)}
					{puzzlehunt && (
						<>
							<h1>{name}</h1>
							<p style={{ width: '50%' }}>
								This page contains a tree view of all the
								puzzles in this hunt along with links to
								associated resources. You can create new rounds
								or puzzles by right-clicking on the parent and
								using the context menu.
							</p>
							<Toolbar>
								<Anchor
									href={`https://drive.google.com/drive/folders/${googleFolderId}`}
									target="_blank"
								>
									Google Drive Puzzle Folder
								</Anchor>
								<Anchor
									href={`discord://discord.com/channels/${guildId}`}
									target="_blank"
								>
									Discord Server
								</Anchor>
								<Button
									onClick={() => {
										setSortByStatus((status) => !status);
									}}
								>
									{sortByStatus
										? 'Switch to tree view'
										: 'Switch to most recent status change view'}
								</Button>
							</Toolbar>
							{rounds.length === 0 && <div>No puzzles yet!</div>}
							<TreeView
								className="puzzle-view"
								onContextMenu={
									settlement && !settlement.canEdit()
										? undefined
										: onContextMenu
								}
							>
								{!sortByStatus &&
									rounds.map((round) => (
										<PuzzleTree
											puzzleObj={round}
											key={round.id}
											guildId={guildId}
										/>
									))}
								{/* The abstractions around MRU here are tech debt and should be revisited before doing much more */}
								{sortByStatus && (
									<MostRecentlyUsed
										puzzlehunt={puzzlehunt}
										guildId={guildId}
									/>
								)}
							</TreeView>
						</>
					)}
				</Card>
			</div>
			{ui}
		</MutationSettlementContext.Provider>
	);
};

function useEditingUI(
	puzzlehunt: IPuzzlehunt,
	httpModel?: PuzzlehuntModel
): {
	onContextMenu: React.MouseEventHandler<HTMLElement>;
	ui: JSX.Element | undefined;
} {
	const [anchorPoint, setAnchorPoint] = React.useState({ x: 0, y: 0 });
	const [showMenu, setShowMenu] = React.useState(false);
	const [showModal, setShowModal] = React.useState(false);
	const [puzzleObj, setPuzzleObj] = React.useState<
		Round | Puzzle | undefined
	>(undefined);
	const [modalArgs, setModalArgs] = React.useState<ModalSpec | undefined>(
		undefined
	);
	React.useEffect(() => {
		setShowMenu(false);
		setShowModal(false);
		setModalArgs(undefined);
	}, [puzzlehunt]);

	const onContextMenu: React.MouseEventHandler<HTMLElement> =
		React.useCallback(
			(event) => {
				const target = event.target as HTMLElement;
				const tryGetPuzzleObj = (
					node: HTMLElement
				): Puzzle | Round | undefined => {
					const [, type, strId] =
						node.id.match(/^(puzzle|round)-obj-(.+)$/) ?? [];
					if (strId) {
						return type === 'round'
							? puzzlehunt.getRound(strId)
							: puzzlehunt.getPuzzle(strId);
					}
					return undefined;
				};

				let puzzleObj = tryGetPuzzleObj(target);
				if (puzzleObj === undefined) {
					if (target.matches('p')) {
						let current = target;
						while (
							current !== undefined &&
							tryGetPuzzleObj(current) === undefined
						) {
							current = current.parentElement;
						}
						puzzleObj = tryGetPuzzleObj(current);
					}
				}

				if (puzzleObj) {
					setPuzzleObj(puzzleObj);
					setAnchorPoint({ x: event.pageX, y: event.pageY });
					setShowMenu(true);
					event.preventDefault();
				}
			},
			[puzzlehunt]
		);

	React.useEffect(() => {
		const onClick = (event: MouseEvent) => {
			if (showMenu) {
				setShowMenu(false);
			} else if (showModal && !httpModel?.isPending) {
				setShowModal(false);
			}
		};
		const onKeyUp = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setShowMenu(false);
				if (!httpModel?.isPending) setShowModal(false);
			}
		};

		window.document.addEventListener('keyup', onKeyUp);
		window.document.addEventListener('click', onClick);
		return () => {
			window.document.removeEventListener('keyup', onKeyUp);
			window.document.removeEventListener('click', onClick);
		};
	}, [showMenu, showModal, httpModel]);

	const openModal = React.useCallback(
		(event: React.MouseEvent, args: ModalSpec) => {
			setShowMenu(false);
			setShowModal(true);
			setModalArgs(args);
			event.stopPropagation();
		},
		[]
	);

	const closeModal = React.useCallback(() => {
		if (httpModel?.isPending) return;
		setShowModal(false);
		setModalArgs(undefined);
	}, [httpModel]);
	let ui: JSX.Element | undefined;
	if (showMenu) {
		ui = (
			<PuzzlePageMenu
				puzzleObj={puzzleObj}
				puzzlehunt={puzzlehunt}
				pageX={anchorPoint.x}
				pageY={anchorPoint.y}
				openModal={openModal}
			/>
		);
	} else if (showModal) {
		if (modalArgs.modalType === 'add') {
			ui = (
				<AddModal
					puzzleObj={puzzleObj}
					puzzlehunt={puzzlehunt}
					createType={modalArgs.createType}
					close={closeModal}
				/>
			);
		} else if (modalArgs.modalType === 'delete') {
			ui = (
				<DeleteModal
					puzzleObj={puzzleObj}
					puzzlehunt={puzzlehunt}
					close={closeModal}
				/>
			);
		} else if (modalArgs.modalType === 'editName') {
			ui = (
				<EditNameModal
					puzzleObj={puzzleObj}
					puzzlehunt={puzzlehunt}
					close={closeModal}
				/>
			);
		} else if (modalArgs.modalType === 'editUrl') {
			ui = (
				<EditUrlModal
					puzzleObj={puzzleObj}
					puzzlehunt={puzzlehunt}
					close={closeModal}
				/>
			);
		} else if (modalArgs.modalType === 'solve') {
			ui = (
				<SolveModal
					puzzleObj={puzzleObj}
					puzzlehunt={puzzlehunt}
					close={closeModal}
				/>
			);
		} else if (
			modalArgs.modalType === 'editSheetId' &&
			puzzleObj.type === 'puzzle'
		) {
			ui = (
				<EditSheetIdModal
					puzzleObj={puzzleObj}
					puzzlehunt={puzzlehunt}
					close={closeModal}
				/>
			);
		}
	}

	return { onContextMenu, ui };
}

type ModalSpec =
	| {
			modalType: 'add';
			createType: 'puzzle' | 'round';
	  }
	| {
			modalType: 'editName';
	  }
	| { modalType: 'editUrl' }
	| {
			modalType: 'editSheetId';
	  }
	| {
			modalType: 'delete';
	  }
	| {
			modalType: 'solve';
	  };

interface PuzzlePageMenu {
	puzzleObj: Round | Puzzle;
	puzzlehunt: IPuzzlehunt;
	pageX: number;
	pageY: number;
	openModal: (event: React.MouseEvent, args: ModalSpec) => void;
}

const PuzzlePageMenu: React.FC<PuzzlePageMenu> = ({
	pageX,
	pageY,
	puzzleObj,
	openModal,
}) => {
	return (
		<Menu style={{ position: 'absolute', left: pageX, top: pageY }}>
			{puzzleObj.type === 'round' && (
				<>
					<MenuItem
						onClick={(event) =>
							openModal(event, {
								modalType: 'add',
								createType: 'puzzle',
							})
						}
					>
						Add a puzzle
					</MenuItem>
					<MenuItem
						onClick={(event) =>
							openModal(event, {
								modalType: 'add',
								createType: 'round',
							})
						}
					>
						Add a round
					</MenuItem>
				</>
			)}
			{puzzleObj.type === 'puzzle' && (
				<MenuItem
					onClick={(event) =>
						openModal(event, {
							modalType: 'add',
							createType: 'puzzle',
						})
					}
				>
					Add a sibling puzzle
				</MenuItem>
			)}
			<MenuItem
				onClick={(event) => openModal(event, { modalType: 'editName' })}
			>
				Change name
			</MenuItem>
			<MenuItem
				onClick={(event) => openModal(event, { modalType: 'editUrl' })}
			>
				Change URL
			</MenuItem>
			{puzzleObj.type === 'puzzle' && (
				<MenuItem
					onClick={(event) =>
						openModal(event, { modalType: 'editSheetId' })
					}
				>
					Change sheet ID
				</MenuItem>
			)}
			{(puzzleObj.type === 'puzzle' ||
				(puzzleObj.type === 'round' &&
					puzzleObj.children.length === 0)) && (
				<MenuItem
					onClick={(event) =>
						openModal(event, { modalType: 'delete' })
					}
				>
					Delete this {puzzleObj.type}
				</MenuItem>
			)}
			{puzzleObj.type === 'puzzle' && (
				<MenuItem
					onClick={(event) =>
						openModal(event, { modalType: 'solve' })
					}
				>
					Solve
				</MenuItem>
			)}
		</Menu>
	);
};

const PuzzleObjCommonListItems: React.FC<{
	puzzleObj: Puzzle | Round;
	guildId: string;
}> = ({ puzzleObj, guildId }) => {
	const { name, url, type, discord: discordInfo } = puzzleObj;
	const settlement = React.useContext(MutationSettlementContext);
	const channelId =
		type === 'puzzle'
			? discordInfo?.channelId
			: discordInfo?.indexChannelId;
	return (
		<>
			<div className="puzzle-or-round-info" />
			<p className="unselectable">{name}</p>
			<Anchor href={url} target="_blank">
				{type === 'puzzle' ? 'Puzzle' : 'Round'} Link
			</Anchor>
			{channelId && (
				<Anchor
					href={`discord://discord.com/channels/${guildId}/${channelId}`}
					target="_blank"
				>
					Discord
				</Anchor>
			)}
			{settlement && !channelId && <span>Discord pending</span>}
		</>
	);
};

const PuzzleListItems: React.FC<{
	puzzleObj: Puzzle;
	guildId: string;
}> = ({ puzzleObj, guildId }) => {
	const settlement = React.useContext(MutationSettlementContext);
	return (
		<>
			<PuzzleObjCommonListItems puzzleObj={puzzleObj} guildId={guildId} />
			{puzzleObj.sheetId && (
				<Anchor
					href={`https://docs.google.com/spreadsheets/d/${puzzleObj.sheetId}`}
					target="_blank"
				>
					Spreadsheet
				</Anchor>
			)}
			{settlement && !puzzleObj.sheetId && (
				<span>Spreadsheet pending</span>
			)}
			{puzzleObj.answer && (
				<p className="unselectable">Answer: {puzzleObj.answer}</p>
			)}
			{puzzleObj.status &&
				puzzleObj.lastStatusUpdate &&
				!puzzleObj.answer && (
					<p>
						Status: "{puzzleObj.status}"{' '}
						<TimeAgo date={puzzleObj.lastStatusUpdate} />
					</p>
				)}
		</>
	);
};

const RoundListItems: React.FC<{
	puzzleObj: Round;
	guildId: string;
}> = ({ puzzleObj, guildId }) => {
	return (
		<>
			<PuzzleObjCommonListItems puzzleObj={puzzleObj} guildId={guildId} />
			{puzzleObj.children.map((child) => (
				<PuzzleTree
					puzzleObj={child}
					key={child.id}
					guildId={guildId}
				/>
			))}
		</>
	);
};

const PuzzleTree: React.FC<{ puzzleObj: Puzzle | Round; guildId: string }> = ({
	puzzleObj,
	guildId,
}) => {
	const { id, type } = puzzleObj;
	return (
		<TreeItem id={`${type}-obj-${id}`}>
			{type === 'puzzle' && (
				<PuzzleListItems puzzleObj={puzzleObj} guildId={guildId} />
			)}
			{type === 'round' && (
				<RoundListItems puzzleObj={puzzleObj} guildId={guildId} />
			)}
		</TreeItem>
	);
};

const MostRecentlyUsed: React.FC<{
	puzzlehunt: IPuzzlehunt;
	guildId: string;
}> = ({ puzzlehunt, guildId }) => {
	const sortedPuzzles = Array.from(puzzlehunt.puzzles)
		.filter((puzzle) => puzzle.status !== undefined)
		.sort((a, b) => b.lastStatusUpdate - a.lastStatusUpdate);
	return (
		<>
			{sortedPuzzles.map((puzzle) => {
				const { id, type } = puzzle;
				return (
					<TreeItem id={`${type}-obj-${id}`} key={id}>
						<PuzzleListItems puzzleObj={puzzle} guildId={guildId} />
					</TreeItem>
				);
			})}
		</>
	);
};

const LoadingSkeleton: React.FC = () => {
	const [visibility, setVisibility] = React.useState<'hidden' | undefined>(
		'hidden'
	);
	React.useEffect(() => {
		let isActive = true;
		// Arbitrary timeout to prevent showing loading UI on fast networks / transitions.
		// This also fixes an ugly flickering where the svg mask hasn't loaded yet.
		setTimeout(() => {
			if (isActive) {
				setVisibility(undefined);
			}
		}, 750);
		return () => {
			isActive = false;
		};
	}, []);
	return (
		<Skeleton
			className="card-pattern"
			style={{
				width: '600px',
				height: '480px',
				visibility,
			}}
			pattern={loadingPuzzlehuntUrl}
			shimmer
		/>
	);
};
