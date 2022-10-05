function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createFetchFn(
	onAuthFailure: () => void
): (input: RequestInfo, init?: RequestInit) => Promise<Response> {
	let currentRateLimitPromise: Promise<void> = undefined;

	// This implementation is a bit overcautious in some ways: discord has per-route rate limits but
	// here we stop sending all requests whenever one comes back 429 (obviously ones in flight will
	// remain in flight). See this for more info:
	// https://discord.com/developers/docs/topics/rate-limits#header-format
	// If rate limits were known in advance it would be more reasonable to do this before waiting for
	// the 429s, but this should be good enough to stay unbanned.
	return async (input, init): Promise<Response> => {
		let response: Response;
		for (let retryCount = 0; retryCount < 4; retryCount++) {
			if (currentRateLimitPromise !== undefined) {
				// Don't start new requests while we're throttled. Note this applies to all requests.
				await currentRateLimitPromise;
			}

			response = await fetch(input, init);
			if (
				response.ok ||
				![500, 503, 429, 401].includes(response.status)
			) {
				return response;
			}
			if (response.status === 401) {
				onAuthFailure();
			} else if (response.status === 429) {
				currentRateLimitPromise = delay(
					Number.parseFloat(
						response.headers.get('x-ratelimit-reset-after')
					) * 1000
				);
			} else {
				await delay(1000 * Math.pow(2, retryCount));
			}
		}
		return response;
	};
}
