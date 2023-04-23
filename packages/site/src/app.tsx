import * as React from 'react';
import { Provider } from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { Router } from './router';
import { persistor, store } from './store/store';
import { WindowSizeSynchronizer } from './components/windowSizeSynchronizer';
import './app.css';

export const App: React.FC = () => {
	return (
		<Provider store={store}>
			<PersistGate loading={null} persistor={persistor}>
				<WindowSizeSynchronizer />
				<Router />
			</PersistGate>
		</Provider>
	);
};
