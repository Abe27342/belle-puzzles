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
import { loadExistingPuzzlehunt } from '@belle-puzzles/puzzlehunt-model/fluid';
import {
	AddModal,
	DeleteModal,
	EditNameModal,
	EditSheetIdModal,
	EditUrlModal,
} from './modals';
import { useStore } from 'react-redux';
import type { AppStore } from '../../store/store';
import { useGetPuzzlehuntContextQuery } from '../../services/belleBotApi';
import { createClient } from './connection';
import TimeAgo from './timeAgo';
import loadingPuzzlehuntUrl from './assets/loading-puzzlehunt.svg';
import libraLogoUrl from './assets/libralogo.png';
import { SolveModal } from './modals/solveModal';

export const Puzzles: React.FC = () => {
	const [puzzlehunt, setPuzzlehunt] = React.useState<IPuzzlehunt>();
	const [sessionError, setSessionError] = React.useState<string>();
	const forceRerender = useForceRerender();

	const { guildId } = useParams() as { guildId: string };
	const {
		data: puzzlehuntContextData,
		isLoading,
		// isSuccess,
		isError,
		error,
	} = useGetPuzzlehuntContextQuery(
		{ guildId },
		{
			refetchOnMountOrArgChange: 10 /* seconds */,
			/* Note: besides allowing puzzlehunt to auto-reload, this also ensures belle-bot keeps
			   watching the document to sync it for changes. */
			pollingInterval: 1000 * 60 * 5,
		}
	);
	const { fluidFileId, googleFolderId, name } = puzzlehuntContextData ?? {};

	const store: AppStore = useStore();
	// TODO: use react async util to avoid isActive kludgery
	React.useEffect(() => {
		let isActive = true;
		let disposeFn: () => void;
		setPuzzlehunt(undefined);
		setSessionError(undefined);
		const loadPuzzlehunt = async (fileId: string) => {
			const authInfo = store.getState().auth.aad;
			const client = await createClient({
				userId: authInfo.userId,
				userName: authInfo.userDetails,
			});
			const session = await loadExistingPuzzlehunt(client, fileId);
			let unsubscribe: (() => void) | undefined;
			let unsubscribeLifecycle: (() => void) | undefined;
			disposeFn = () => {
				unsubscribe?.();
				unsubscribeLifecycle?.();
				void session.close().catch((error) => {
					console.error('Failed to close puzzlehunt.', error);
				});
			};
			if (isActive) {
				unsubscribe = session.puzzlehunt.subscribe(forceRerender);
				setPuzzlehunt(session.puzzlehunt);
				unsubscribeLifecycle = session.subscribeLifecycle((state) => {
					if (
						state.status === 'closed' ||
						state.status === 'failed'
					) {
						setPuzzlehunt(undefined);
						setSessionError(
							state.status === 'failed'
								? state.error.message
								: 'Puzzlehunt session closed.'
						);
					}
				});
			} else {
				disposeFn();
			}
		};

		if (fluidFileId) {
			loadPuzzlehunt(fluidFileId).catch((error: unknown) => {
				console.error('Failed to load puzzlehunt.', error);
				if (isActive) {
					setSessionError(
						error instanceof Error ? error.message : String(error)
					);
				}
			});
		}
		return () => {
			isActive = false;
			disposeFn?.();
		};
	}, [forceRerender, fluidFileId, store]);

	const [sortByStatus, setSortByStatus] = React.useState(false);

	const rounds = Array.from(puzzlehunt?.rounds ?? []);
	rounds.sort((a, b) => a.name.localeCompare(b.name));
	const { onContextMenu, ui } = useEditingUI(puzzlehunt);
	return (
		<>
			<div id="puzzles" className="page-body">
				<Card>
					<img id="libralogo" src={libraLogoUrl} />
					{!puzzlehunt && !isError && !sessionError && (
						<LoadingSkeleton />
					)}
					{sessionError && <div role="alert">{sessionError}</div>}
					{isError && (
						<div>
							{(error as any).status === 404
								? 'Puzzlehunt not found.'
								: `Error loading puzzlehunt content: ${
										(error as any).message ?? error
								  }`}
						</div>
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
								onContextMenu={onContextMenu}
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
		</>
	);
};

function useEditingUI(puzzlehunt: IPuzzlehunt): {
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
			} else if (showModal) {
				setShowModal(false);
			}
		};
		const onKeyUp = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setShowMenu(false);
				setShowModal(false);
			}
		};

		window.document.addEventListener('keyup', onKeyUp);
		window.document.addEventListener('click', onClick);
		return () => {
			window.document.addEventListener('keyup', onKeyUp);
			window.document.removeEventListener('click', onClick);
		};
	}, [showMenu, showModal]);

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
		setShowModal(false);
		setModalArgs(undefined);
	}, []);
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
	return (
		<>
			<div className="puzzle-or-round-info" />
			<p className="unselectable">{name}</p>
			<Anchor href={url} target="_blank">
				{type === 'puzzle' ? 'Puzzle' : 'Round'} Link
			</Anchor>
			{discordInfo && (
				<Anchor
					href={`discord://discord.com/channels/${guildId}/${
						type === 'puzzle'
							? discordInfo.channelId
							: discordInfo.indexChannelId
					}`}
					target="_blank"
				>
					Discord
				</Anchor>
			)}
		</>
	);
};

const PuzzleListItems: React.FC<{
	puzzleObj: Puzzle;
	guildId: string;
}> = ({ puzzleObj, guildId }) => {
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

function useForceRerender(): () => void {
	const [, setVal] = React.useState(0);
	return React.useCallback(() => setVal((prev) => prev + 1), []);
}

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
