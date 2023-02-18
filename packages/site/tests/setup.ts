import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import createFetchMock from 'vitest-fetch-mock';
import '@testing-library/jest-dom';

const fetchMock = createFetchMock(vi);
fetchMock.enableMocks();

// runs a cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
	cleanup();
});

const noop = () => {};

// FAST libraries reference this on load. mock it globaly with low fidelity.
Object.defineProperty(window, 'matchMedia', {
	writable: true,
	value: (query) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: noop, // deprecated
		removeListener: noop, // deprecated
		addEventListener: noop,
		removeEventListener: noop,
		dispatchEvent: noop,
	}),
});
