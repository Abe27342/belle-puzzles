import { createAction, createReducer } from '@reduxjs/toolkit';

export interface WindowSize {
	width: number;
	height: number;
}

export const windowSizeChanged = createAction<WindowSize>('windowSizeChanged');

export const windowSizeReducer = createReducer<WindowSize>(
	{ width: 0, height: 0 },
	(builder) =>
		builder.addCase(windowSizeChanged, (_state, action) => {
			return {
				height: action.payload.height,
				width: action.payload.width,
			};
		})
);
