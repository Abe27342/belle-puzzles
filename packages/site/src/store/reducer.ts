import { combineReducers } from '@reduxjs/toolkit';
import { authReducer } from './auth';
import { discordApi } from '../services/discordApi';
import { swaApi } from '../services/swaApi';
import { belleBotApi } from '../services/belleBotApi';

export const rootReducer = combineReducers({
	auth: authReducer,
	[discordApi.reducerPath]: discordApi.reducer,
	[swaApi.reducerPath]: swaApi.reducer,
	[belleBotApi.reducerPath]: belleBotApi.reducer,
});
