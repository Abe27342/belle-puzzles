import * as React from 'react';
import '../css/puzzles.css';
import type { NodeId } from '@fluid-experimental/tree';
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
} from '../../fast';
import {
	IPuzzlehunt,
	loadExistingPuzzlehunt,
	Puzzle,
	Round,
} from '@belle-puzzles/puzzlehunt-model';
import {
	AddModal,
	DeleteModal,
	EditNameModal,
	EditSheetIdModal,
} from './modals';
import { useStore } from 'react-redux';
import type { AppStore } from '../../store/store';
import { useGetPuzzlehuntContextQuery } from '../../services/belleBotApi';
import { createClient } from './connection';

export const Puzzles: React.FC = () => {
	const [puzzlehunt, setPuzzlehunt] = React.useState<IPuzzlehunt>();
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
		const loadPuzzlehunt = async () => {
			const authInfo = store.getState().auth.aad;
			const client = await createClient({
				userId: authInfo.userId,
				userName: authInfo.userDetails,
			});
			const { puzzlehunt, disposer } = await loadExistingPuzzlehunt(
				client,
				fluidFileId
			);
			disposeFn = () => disposer.dispose();
			if (isActive) {
				puzzlehunt.on('viewChange', forceRerender);
				setPuzzlehunt(puzzlehunt);
			} else {
				disposeFn();
			}
		};

		if (fluidFileId) {
			loadPuzzlehunt().catch((err) => console.log(err));
		}
		return () => {
			isActive = false;
			disposeFn?.();
		};
	}, [forceRerender, fluidFileId, store]);

	const rounds = Array.from(puzzlehunt?.rounds ?? []);
	rounds.sort((a, b) => a.name.localeCompare(b.name));
	const { onContextMenu, ui } = useEditingUI(puzzlehunt);
	return (
		<>
			<div id="puzzles" className="page-body">
				<Card>
					<img id="libralogo" src="/libralogo1.png" />
					{isLoading && <Skeleton />}
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
									href={`https://discord.com/channels/${guildId}`}
									target="_blank"
								>
									Discord Server
								</Anchor>
							</Toolbar>
							<TreeView
								className="puzzle-view"
								onContextMenu={onContextMenu}
							>
								{rounds.map((round) => (
									<PuzzleTree
										puzzleObj={round}
										key={round.id}
										guildId={guildId}
									/>
								))}
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
						node.id.match(/(puzzle|round)\-obj\-(\-?\d*)/) ?? [];
					if (strId) {
						const id = Number.parseInt(strId) as unknown as NodeId;
						return type === 'round'
							? puzzlehunt.getRound(id)
							: puzzlehunt.getPuzzle(id);
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

	const openModal = React.useCallback((args: ModalSpec) => {
		setShowMenu(false);
		setShowModal(true);
		setModalArgs(args);
	}, []);

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
	| {
			modalType: 'editSheetId';
	  }
	| {
			modalType: 'delete';
	  };

interface PuzzlePageMenu {
	puzzleObj: Round | Puzzle;
	puzzlehunt: IPuzzlehunt;
	pageX: number;
	pageY: number;
	openModal: (args: ModalSpec) => void;
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
						onClick={() =>
							openModal({
								modalType: 'add',
								createType: 'puzzle',
							})
						}
					>
						Add a puzzle
					</MenuItem>
					<MenuItem
						onClick={() =>
							openModal({ modalType: 'add', createType: 'round' })
						}
					>
						Add a round
					</MenuItem>
				</>
			)}
			{puzzleObj.type === 'puzzle' && (
				<MenuItem
					onClick={() =>
						openModal({ modalType: 'add', createType: 'puzzle' })
					}
				>
					Add a sibling puzzle
				</MenuItem>
			)}
			<MenuItem onClick={() => openModal({ modalType: 'editName' })}>
				Change name
			</MenuItem>
			{puzzleObj.type === 'puzzle' && (
				<MenuItem
					onClick={() => openModal({ modalType: 'editSheetId' })}
				>
					Change sheet ID
				</MenuItem>
			)}
			{(puzzleObj.type === 'puzzle' ||
				(puzzleObj.type === 'round' &&
					puzzleObj.children.length === 0)) && (
				<MenuItem onClick={() => openModal({ modalType: 'delete' })}>
					Delete this {puzzleObj.type}
				</MenuItem>
			)}
		</Menu>
	);
};

const PuzzleTree: React.FC<{ puzzleObj: Puzzle | Round; guildId: string }> = ({
	puzzleObj,
	guildId,
}) => {
	const { id, name, url, type, discordInfo } = puzzleObj;
	return (
		<TreeItem id={`${type}-obj-${id}`}>
			<div className="puzzle-or-round-info" />
			<p>{name}</p>
			<Anchor href={url} target="_blank">
				{type === 'puzzle' ? 'Puzzle' : 'Round'} Link
			</Anchor>
			{discordInfo && (
				<Anchor
					href={`https://discord.com/channels/${guildId}/${
						type === 'puzzle'
							? discordInfo.channelId
							: discordInfo.indexChannelId
					}`}
					target="_blank"
				>
					Discord
				</Anchor>
			)}
			{type === 'puzzle' && (
				<>
					{puzzleObj.sheetId && (
						<Anchor
							href={`https://docs.google.com/spreadsheets/d/${puzzleObj.sheetId}`}
							target="_blank"
						>
							Spreadsheet
						</Anchor>
					)}
					{puzzleObj.answer && <p>Answer: {puzzleObj.answer}</p>}
				</>
			)}
			{type === 'round' &&
				puzzleObj.children.map((child) => (
					<PuzzleTree
						puzzleObj={child}
						key={child.id}
						guildId={guildId}
					/>
				))}
		</TreeItem>
	);
};

function useForceRerender(): () => void {
	const [, setVal] = React.useState(0);
	return React.useCallback(() => setVal((prev) => prev + 1), []);
}
