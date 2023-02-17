const redirectKey = 'REDIRECT_PATHNAME';

/**
 * Sets up the next load of '/' to redirect to `pathname`. This is primarily useful for oauth2
 * flows by forwarding the user to return to whatever page they were on (some auth providers support
 * redirect parameters, but rather than deal with differences it's easier to use this unified mechanism)
 */
export function setPostRedirectPath(pathname: string | null): void {
	if (!pathname) {
		window.localStorage.removeItem(redirectKey);
	} else {
		window.localStorage.setItem(redirectKey, pathname);
	}
}

export function getPostRedirectPath(): string | null {
	return window.localStorage.getItem(redirectKey);
}
