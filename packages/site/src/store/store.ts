import { configureStore } from '@reduxjs/toolkit';
import {
	FLUSH,
	REHYDRATE,
	PAUSE,
	PERSIST,
	PURGE,
	REGISTER,
	persistStore,
	persistReducer,
} from 'redux-persist';
// Default value here is localStorage, which should be fine as we're persisting a small amount of data (mostly just auth tokens)
import storage from 'redux-persist/lib/storage';
import { rootReducer } from './reducer';
import { discordApi } from '../services/discordApi';
import { swaApi } from '../services/swaApi';
import { belleBotApi } from '../services/belleBotApi';

const persistConfig = {
	key: 'root',
	// Note: query state is persisted cross-session. See https://redux-toolkit.js.org/rtk-query/usage/persistence-and-rehydration
	// for more details. This requires care in some components to guard against stale data. Since most of the application data
	// is from the fluid file and user's profile / discord servers, the invalidation model isn't too complex (and all of those
	// values are reasonable enough to assume infrequent updates to). Generally using RTK-query's hook additional options suffices.
	storage,
	blacklist: ['windowSize'],
};

export const store = configureStore({
	reducer: persistReducer(persistConfig, rootReducer),
	middleware: (getDefaultMiddleware) =>
		getDefaultMiddleware({
			serializableCheck: {
				ignoredActions: [
					FLUSH,
					REHYDRATE,
					PAUSE,
					PERSIST,
					PURGE,
					REGISTER,
				],
			},
		}).concat(
			discordApi.middleware,
			swaApi.middleware,
			belleBotApi.middleware
		),
});
export const persistor = persistStore(store);

export type AppStore = typeof store;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export type AppThunkApiConfig = {
	store: typeof store;
	dispatch: AppDispatch;
	state: RootState;
};

if (import.meta.hot) {
	// Note: this code is unvetted. It's very possible HMR doesn't quite work yet. However, this is basically
	// what's suggested by https://github.com/rt2zz/redux-persist/blob/master/docs/hot-module-replacement.md
	import.meta.hot?.accept('./reducer', () => {
		const nextRootReducer = require('./reducer').rootReducer;
		store.replaceReducer(persistReducer(persistConfig, nextRootReducer));
	});
}
