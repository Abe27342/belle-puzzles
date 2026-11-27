import * as React from 'react';

export function createEmptyDoubledResolutionGrid(
	width: number,
	height: number
): string {
	const normalizedWidth = Math.max(1, Math.floor(width));
	const normalizedHeight = Math.max(1, Math.floor(height));
	const rows: string[] = [];
	for (let y = 0; y <= normalizedHeight * 2; y++) {
		let row = '';
		for (let x = 0; x <= normalizedWidth * 2; x++) {
			if (x % 2 === 0 && y % 2 === 0) row += '·';
			else if (x % 2 === 1 && y % 2 === 0) row += '-';
			else if (x % 2 === 0 && y % 2 === 1) row += '|';
			else row += '#';
		}
		rows.push(row);
	}
	return rows.join('\n');
}

export function EmptyGridGenerator() {
	const [width, setWidth] = React.useState(8);
	const [height, setHeight] = React.useState(8);
	const [copyStatus, setCopyStatus] = React.useState('');

	return (
		<section
			className="empty-grid-generator"
			aria-labelledby="empty-grid-heading"
		>
			<h2 id="empty-grid-heading">Copy an empty grid</h2>
			<div className="empty-grid-controls">
				<label>
					Width
					<input
						type="number"
						min="1"
						max="30"
						value={width}
						onChange={(event) =>
							setWidth(
								Math.max(1, Number(event.target.value) || 1)
							)
						}
					/>
				</label>
				<label>
					Height
					<input
						type="number"
						min="1"
						max="30"
						value={height}
						onChange={(event) =>
							setHeight(
								Math.max(1, Number(event.target.value) || 1)
							)
						}
					/>
				</label>
				<button
					type="button"
					onClick={async () => {
						try {
							await navigator.clipboard.writeText(
								createEmptyDoubledResolutionGrid(width, height)
							);
							setCopyStatus('Empty grid copied');
						} catch {
							setCopyStatus('Unable to copy empty grid');
						}
					}}
				>
					Copy
				</button>
			</div>
			<p role="status">{copyStatus}</p>
		</section>
	);
}
