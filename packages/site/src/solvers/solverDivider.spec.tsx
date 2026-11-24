import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SolverDivider } from './solverDivider';

function bounds(x: number, width: number): DOMRect {
	const rect = {
		x,
		y: 0,
		width,
		height: 400,
		top: 0,
		bottom: 400,
		left: x,
		right: x + width,
	};
	return { ...rect, toJSON: () => rect };
}

it('resizes while the pointer is captured, clamps widths, and releases on completion', () => {
	const onChange = vi.fn();
	render(
		<div>
			<section className="solver-input" data-testid="input" />
			<SolverDivider value={50} onChange={onChange} />
			<section className="solver-output" data-testid="output" />
		</div>
	);
	const divider = screen.getByRole('separator');
	vi.spyOn(
		screen.getByTestId('input'),
		'getBoundingClientRect'
	).mockReturnValue(bounds(100, 400));
	vi.spyOn(
		screen.getByTestId('output'),
		'getBoundingClientRect'
	).mockReturnValue(bounds(508, 400));
	vi.spyOn(divider, 'getBoundingClientRect').mockReturnValue(bounds(500, 8));
	let captured = false;
	const capture = vi.fn(() => {
		captured = true;
	});
	const release = vi.fn(() => {
		captured = false;
	});
	Object.defineProperties(divider, {
		setPointerCapture: { value: capture },
		hasPointerCapture: { value: () => captured },
		releasePointerCapture: { value: release },
	});
	const pointer = (type: string, clientX: number) => {
		const event = new MouseEvent(type, {
			bubbles: true,
			button: 0,
			clientX,
		});
		Object.defineProperty(event, 'pointerId', { value: 1 });
		fireEvent(divider, event);
	};
	pointer('pointerdown', 504);
	expect(capture).toHaveBeenCalledWith(1);
	expect(onChange).toHaveBeenLastCalledWith(50);
	pointer('pointermove', 664);
	expect(onChange).toHaveBeenLastCalledWith(70);
	pointer('pointermove', 0);
	expect(onChange).toHaveBeenLastCalledWith(25);
	pointer('pointermove', 2000);
	expect(onChange).toHaveBeenLastCalledWith(75);
	pointer('pointercancel', 2000);
	expect(release).toHaveBeenCalledWith(1);
	const count = onChange.mock.calls.length;
	pointer('pointermove', 600);
	expect(onChange).toHaveBeenCalledTimes(count);
	pointer('pointerdown', 504);
	pointer('pointerup', 504);
	expect(release).toHaveBeenCalledTimes(2);
});
