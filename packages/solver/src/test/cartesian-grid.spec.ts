import { expect, it } from 'vitest';
import { Point, Vector } from '../lib/graph/point.js';
import { CartesianGridGraph } from '../lib/graph/cartesian-grid.js';

it('provides named point and vector components', () => {
	const point = new Point(2, 3);
	const vector = new Vector(-1, 4);

	expect(point.x).toBe(2);
	expect(point.y).toBe(3);
	expect([...point]).toEqual([2, 3]);
	expect(point.add(vector)).toEqual(new Point(1, 7));
	expect(point.subtract(new Point(1, 1))).toEqual(new Vector(1, 2));

	expect(vector.dx).toBe(-1);
	expect(vector.dy).toBe(4);
	expect([...vector]).toEqual([-1, 4]);
});

it('reports face and vertex dimensions separately', () => {
	const faceGrid = new CartesianGridGraph({
		faceWidth: 4,
		faceHeight: 3,
	});
	expect(faceGrid.faceWidth).toBe(4);
	expect(faceGrid.faceHeight).toBe(3);
	expect(faceGrid.vertexWidth).toBe(5);
	expect(faceGrid.vertexHeight).toBe(4);

	const vertexGrid = new CartesianGridGraph({
		width: 5,
		height: 4,
	});
	expect(vertexGrid.vertexWidth).toBe(5);
	expect(vertexGrid.vertexHeight).toBe(4);
	expect(vertexGrid.faceWidth).toBe(4);
	expect(vertexGrid.faceHeight).toBe(3);
});
