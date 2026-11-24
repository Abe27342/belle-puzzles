import * as React from 'react';

const minimum = 25;
const maximum = 75;
const clamp = (value: number) =>
	Math.max(minimum, Math.min(maximum, Math.round(value)));

export function SolverDivider({
	value,
	onChange,
}: {
	value: number;
	onChange: (value: number) => void;
}) {
	const resize = (event: React.PointerEvent<HTMLDivElement>) => {
		const parent = event.currentTarget.parentElement;
		const input = parent?.querySelector<HTMLElement>('.solver-input');
		const output = parent?.querySelector<HTMLElement>('.solver-output');
		if (!input || !output) {
			console.error(
				'Cannot resize solver columns: input or solution panel is missing.'
			);
			return;
		}
		const inputBounds = input.getBoundingClientRect();
		const width = inputBounds.width + output.getBoundingClientRect().width;
		if (width <= 0) {
			console.error(
				'Cannot resize solver columns with zero available width.'
			);
			return;
		}
		const halfDivider =
			event.currentTarget.getBoundingClientRect().width / 2;
		onChange(
			clamp(
				(100 * (event.clientX - inputBounds.left - halfDivider)) / width
			)
		);
	};
	const release = (event: React.PointerEvent<HTMLDivElement>) => {
		if (event.currentTarget.hasPointerCapture(event.pointerId)) {
			event.currentTarget.releasePointerCapture(event.pointerId);
		}
	};
	return (
		<div
			className="solver-divider"
			role="separator"
			aria-label="Resize input and solution columns"
			aria-orientation="vertical"
			aria-controls="solver-input-pane solver-output-pane"
			aria-valuemin={minimum}
			aria-valuemax={maximum}
			aria-valuenow={value}
			aria-valuetext={`Input ${value}%; solutions ${100 - value}%`}
			tabIndex={0}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				event.currentTarget.focus();
				event.currentTarget.setPointerCapture(event.pointerId);
				resize(event);
			}}
			onPointerMove={(event) => {
				if (event.currentTarget.hasPointerCapture(event.pointerId))
					resize(event);
			}}
			onPointerUp={release}
			onPointerCancel={release}
			onKeyDown={(event) => {
				const values: Record<string, number> = {
					ArrowLeft: value - 5,
					ArrowRight: value + 5,
					Home: minimum,
					End: maximum,
				};
				if (Object.prototype.hasOwnProperty.call(values, event.key)) {
					event.preventDefault();
					onChange(clamp(values[event.key]));
				}
			}}
		/>
	);
}
