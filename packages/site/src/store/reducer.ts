import { combineReducers } from '@reduxjs/toolkit';
import { authReducer } from './auth';
import { discordApi } from '../services/discordApi';
import { swaApi } from '../services/swaApi';
import { belleBotApi } from '../services/belleBotApi';
import { windowSizeReducer } from './windowSize';

export const rootReducer = combineReducers({
	auth: authReducer,
	windowSize: windowSizeReducer,
	[discordApi.reducerPath]: discordApi.reducer,
	[swaApi.reducerPath]: swaApi.reducer,
	[belleBotApi.reducerPath]: belleBotApi.reducer,
});
