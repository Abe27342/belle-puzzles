import * as React from 'react';
import { NavLink, useParams } from 'react-router-dom';
import { isPuzzleType, puzzleTypes } from '@belle-puzzles/solver';
import { createSolverClient } from './client';
import {
	canCancel,
	isSolving,
	type SolverSessionState,
	type Uniqueness,
} from './solverSession';
import { useSolverSession } from './useSolverSession';
import { usePreparedSolverClient } from './usePreparedSolverClient';
import { SolverDivider } from './solverDivider';
import './solvers.css';

const uniquenessLabels: Record<Uniqueness, string> = {
	unchecked: '',
	checking: 'Checking whether the solution is unique...',
	unique: 'This solution is unique.',
	multiple: '',
	unknown: 'The solver could not determine whether this solution is unique.',
	cancelled: 'Uniqueness check cancelled; uniqueness is not known.',
};

export function SolverNavigation() {
	const [expanded, setExpanded] = React.useState(true);
	const [mobile, setMobile] = React.useState(
		() => window.matchMedia('(max-width: 640px)').matches
	);
	const [mobileOpen, setMobileOpen] = React.useState(false);
	const [search, setSearch] = React.useState('');
	const menu = React.useRef<HTMLElement>(null);
	const trigger = React.useRef<HTMLButtonElement>(null);
	const searchInput = React.useRef<HTMLInputElement>(null);
	React.useEffect(() => {
		const media = window.matchMedia('(max-width: 640px)');
		const onChange = (event: MediaQueryListEvent) => {
			setMobile(event.matches);
			setMobileOpen(false);
		};
		media.addEventListener('change', onChange);
		return () => media.removeEventListener('change', onChange);
	}, []);
	React.useEffect(() => {
		if (!mobile || !mobileOpen) return;
		searchInput.current?.focus();
		const onPointerDown = (event: PointerEvent) => {
			if (
				event.target instanceof Node &&
				!menu.current?.contains(event.target)
			) {
				setMobileOpen(false);
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				setMobileOpen(false);
				trigger.current?.focus();
			}
		};
		document.addEventListener('pointerdown', onPointerDown);
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown);
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [mobile, mobileOpen]);
	const open = mobile ? mobileOpen : expanded;
	const toggleLabel = mobile
		? mobileOpen
			? 'Close puzzle menu'
			: 'Choose puzzle'
		: expanded
		? 'Collapse puzzle menu'
		: 'Expand puzzle menu';
	const matches = Object.entries(puzzleTypes)
		.filter(([, { name }]) =>
			name.toLowerCase().includes(search.trim().toLowerCase())
		)
		.sort(([, left], [, right]) => left.name.localeCompare(right.name));
	return (
		<aside
			ref={menu}
			className={`solver-menu${
				!mobile && !expanded ? ' solver-menu-collapsed' : ''
			}`}
			onBlur={(event) => {
				if (
					mobile &&
					event.relatedTarget instanceof Node &&
					!event.currentTarget.contains(event.relatedTarget)
				) {
					setMobileOpen(false);
				}
			}}
		>
			<div className="solver-menu-heading">
				{!mobile && expanded && <h2>Puzzles</h2>}
				<button
					ref={trigger}
					type="button"
					className="solver-menu-toggle"
					aria-label={toggleLabel}
					title={toggleLabel}
					aria-expanded={open}
					aria-haspopup={mobile ? 'dialog' : undefined}
					aria-controls="solver-menu-content"
					onClick={() =>
						mobile
							? setMobileOpen((value) => !value)
							: setExpanded((value) => !value)
					}
				>
					<svg
						viewBox="0 0 24 24"
						aria-hidden="true"
						focusable="false"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.75"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						{mobile ? (
							<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" />
						) : (
							<>
								<rect
									x="3"
									y="4"
									width="18"
									height="16"
									rx="2"
								/>
								<path d="M9 4v16" />
								<path
									d={
										open
											? 'M15 9l-3 3 3 3'
											: 'M12 9l3 3-3 3'
									}
								/>
							</>
						)}
					</svg>
					{mobile && (
						<>
							<span>Puzzles</span>
							<svg
								className="solver-menu-caret"
								viewBox="0 0 24 24"
								aria-hidden="true"
								focusable="false"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.75"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<path
									d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}
								/>
							</svg>
						</>
					)}
				</button>
			</div>
			<div
				id="solver-menu-content"
				hidden={!open}
				role={mobile ? 'dialog' : undefined}
				aria-label={mobile ? 'Choose a puzzle' : undefined}
			>
				<div className="solver-menu-search">
					<label htmlFor="puzzle-search">Search puzzles</label>
					<input
						ref={searchInput}
						id="puzzle-search"
						type="search"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Puzzle name"
					/>
				</div>
				<nav aria-label="Puzzle solvers">
					<ul>
						{matches.map(([type, { name }]) => (
							<li key={type}>
								<NavLink
									to={`/solvers/${type}`}
									onClick={() => {
										if (mobile) {
											setMobileOpen(false);
											trigger.current?.focus();
										}
									}}
								>
									{name}
								</NavLink>
							</li>
						))}
					</ul>
				</nav>
				{matches.length === 0 && (
					<p>
						No matching puzzles. Try another name or clear the
						search.
					</p>
				)}
			</div>
		</aside>
	);
}

export function SolverRoute() {
	const { puzzleType } = useParams();
	const [text, setText] = React.useState('');
	const createClient = usePreparedSolverClient(
		puzzleType && isPuzzleType(puzzleType) ? puzzleType : undefined
	);
	const [inputShare, setInputShare] = React.useState(50);
	const style: React.CSSProperties & {
		'--solver-input-share': string;
		'--solver-output-share': string;
	} = {
		'--solver-input-share': `${inputShare}fr`,
		'--solver-output-share': `${100 - inputShare}fr`,
	};
	const divider = (
		<SolverDivider value={inputShare} onChange={setInputShare} />
	);
	return (
		<main className="solver-area" style={style}>
			<SolverNavigation />
			{puzzleType && isPuzzleType(puzzleType) ? (
				<SolverPage
					key={puzzleType}
					puzzleType={puzzleType}
					text={text}
					onTextChange={setText}
					divider={divider}
					createClient={createClient}
				/>
			) : (
				<>
					<section id="solver-input-pane" className="solver-input">
						<h1>Logic Puzzle Solvers</h1>
						<p>
							No login required. Puzzles are solved locally in
							your browser.
						</p>
						<p>
							{puzzleType
								? 'Unknown puzzle type. Choose a puzzle from the menu.'
								: 'Choose a puzzle from the menu to get started.'}
						</p>
					</section>
					{divider}
				</>
			)}
			{(!puzzleType || !isPuzzleType(puzzleType)) && (
				<section
					id="solver-output-pane"
					className="solver-output"
					aria-labelledby="solutions-title"
				>
					<h2 id="solutions-title">Solutions</h2>
					<p>
						Select a puzzle to enter its clues and see solutions
						here.
					</p>
				</section>
			)}
		</main>
	);
}

function ElapsedText() {
	const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
	React.useEffect(() => {
		const startedAt = Date.now();
		const interval = window.setInterval(() => {
			setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
		}, 1000);
		return () => window.clearInterval(interval);
	}, []);
	return (
		<>
			({elapsedSeconds} {elapsedSeconds === 1 ? 'second' : 'seconds'}{' '}
			elapsed)
		</>
	);
}

export function SolverPage({
	puzzleType,
	text,
	onTextChange,
	divider,
	createClient = createSolverClient,
}: {
	puzzleType: string;
	text: string;
	onTextChange: (text: string) => void;
	divider?: React.ReactNode;
	createClient?: typeof createSolverClient;
}) {
	const definition = puzzleTypes[puzzleType];
	const { state, solve, next, cancel, reset } = useSolverSession(
		puzzleType,
		createClient
	);
	const changeInput = (value: string) => {
		reset();
		onTextChange(value);
	};
	return (
		<>
			<SolverInput
				definition={definition}
				text={text}
				onTextChange={changeInput}
				onSolve={() => solve(text)}
				onNext={next}
				onCancel={cancel}
				busy={isSolving(state)}
				canNext={state.phase === 'ready'}
				canCancel={canCancel(state)}
			/>
			{divider}
			<SolverResults state={state} onNext={next} />
		</>
	);
}

function SolverInput({
	definition,
	text,
	onTextChange,
	onSolve,
	onNext,
	onCancel,
	busy,
	canNext,
	canCancel,
}: {
	definition: (typeof puzzleTypes)[string];
	text: string;
	onTextChange: (text: string) => void;
	onSolve: () => void;
	onNext: () => void;
	onCancel: () => void;
	busy: boolean;
	canNext: boolean;
	canCancel: boolean;
}) {
	return (
		<section
			id="solver-input-pane"
			className="solver-input"
			aria-labelledby="puzzle-title"
		>
			<h1 id="puzzle-title">{definition.name}</h1>
			<p id="input-help">
				{definition.instructions} Use a dot (".") or single space (" ")
				for an empty position. Rows must have equal lengths.
			</p>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					onSolve();
				}}
			>
				<label htmlFor="puzzle-input">Puzzle text</label>
				<textarea
					id="puzzle-input"
					value={text}
					placeholder={`${definition.example}\n\n(example)`}
					onChange={(event) => onTextChange(event.target.value)}
					aria-describedby="input-help"
					spellCheck={false}
					rows={12}
					required
				/>
				<div className="solver-actions">
					<button
						type="button"
						onClick={() => onTextChange(definition.example)}
					>
						Load example
					</button>
					<button type="submit" disabled={busy || !text.trim()}>
						Solve
					</button>
					<button type="button" disabled={!canNext} onClick={onNext}>
						Find next solution
					</button>
					<button
						type="button"
						disabled={!canCancel}
						onClick={onCancel}
					>
						Cancel
					</button>
				</div>
			</form>
		</section>
	);
}

function sessionMessage(state: SolverSessionState): string {
	if (state.phase === 'idle' && state.cancelled) {
		return 'Solving cancelled. Displayed solutions are preserved; solve again to start a new session.';
	}
	const result =
		state.phase === 'done'
			? state
			: state.phase === 'idle'
			? state.result
			: undefined;
	if (!result) return '';
	switch (result.outcome) {
		case 'unknown':
			return 'The solver returned unknown. This does not prove that no further solutions exist.';
		case 'no-solutions':
			return 'This puzzle has no solutions. Check that the clues are correct and do not contradict each other.';
		case 'exhausted':
			return state.uniqueness === 'unique' ? '' : 'No more solutions.';
		case 'error':
			return '';
	}
}

function SolverResults({
	state,
	onNext,
}: {
	state: SolverSessionState;
	onNext: () => void;
}) {
	const { phase, solutions, uniqueness } = state;
	const result =
		phase === 'done' ? state : phase === 'idle' ? state.result : undefined;
	const exhausted = result?.outcome === 'exhausted';
	const error = result?.outcome === 'error' ? result.error : '';
	const message = sessionMessage(state);
	return (
		<section
			id="solver-output-pane"
			className="solver-output"
			aria-labelledby="solutions-title"
		>
			<h2 id="solutions-title">Solutions</h2>
			<div>
				{solutions.map((output, index) => (
					<article key={index}>
						<h3>Solution {index + 1}</h3>
						<pre aria-label={`Solution ${index + 1} grid`}>
							{output}
						</pre>
					</article>
				))}
				{uniqueness === 'multiple' && !exhausted && (
					<p className="solver-solution-more">
						This puzzle has multiple solutions.{' '}
						<button
							type="button"
							className="solver-next-link"
							aria-label="Find another solution"
							disabled={phase !== 'ready'}
							onClick={onNext}
						>
							Find next...
						</button>
					</p>
				)}
			</div>
			<div role="status" aria-live="polite">
				{phase === 'idle' &&
					solutions.length === 0 &&
					!message &&
					!error && (
						<p>
							Enter a puzzle and choose Solve to see its
							solutions.
						</p>
					)}
				{phase === 'first' && (
					<p>
						Solving... <ElapsedText key={phase} />
					</p>
				)}
				{phase === 'next' && (
					<p>
						Finding the next solution... <ElapsedText key={phase} />
					</p>
				)}
				{uniquenessLabels[uniqueness] && (
					<p>
						{uniquenessLabels[uniqueness]}
						{phase === 'uniqueness' && (
							<>
								{' '}
								<ElapsedText key={phase} />
							</>
						)}
					</p>
				)}
				{message && <p>{message}</p>}
			</div>
			{error && <p role="alert">{error}</p>}
		</section>
	);
}
