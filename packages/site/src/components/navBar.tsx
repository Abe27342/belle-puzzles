import * as React from 'react';
import { Outlet, useNavigate } from 'react-router';
import { Anchor, Card, Menu, MenuItem } from '../fast';
import { getMicrosoftUser, isLoggedIn } from '../store/auth';
import { useAppSelector } from '../store/hooks';
import { DiscordProfile } from './discordProfile';
import { RootState } from '../store/store';
import { HamburgerIcon } from './hamburger';

enum ScreenSize {
	// Hamburger menu
	Small,
	// Expanded menu without login info
	Medium,
	// Expanded menu with login info
	Large,
}

function getScreenSize(state: RootState): ScreenSize {
	if (state.windowSize.width < 600) {
		return ScreenSize.Small;
	} else if (state.windowSize.width < 1200) {
		return ScreenSize.Medium;
	} else {
		return ScreenSize.Large;
	}
}

export const NavBar: React.FC = () => {
	const size = useAppSelector(getScreenSize);
	return (
		<>
			<header className="header nav-header">
				{size === ScreenSize.Small ? (
					<CollapsedNavBar />
				) : (
					<LargerNavBar includeAvatars={size === ScreenSize.Large} />
				)}
			</header>
			<Outlet />
		</>
	);
};

const LargerNavBar: React.FC<{ includeAvatars: boolean }> = ({
	includeAvatars,
}) => (
	<>
		<Logo />
		<PageNavigation />
		<AccountInfo includeAvatars={includeAvatars} />
	</>
);

const CollapsedNavBar: React.FC = () => {
	return (
		<>
			<Logo />
			<HamburgerMenu />
		</>
	);
};

const Logo = () => (
	<li>
		<Card className="nav-bar-card">Belle Puzzles Bot</Card>
	</li>
);

const HamburgerMenu: React.FC = () => {
	const [open, setOpen] = React.useState(false);
	useSoftDismiss(open, setOpen);

	const onChange: React.ChangeEventHandler<HTMLInputElement> =
		React.useCallback((event) => {
			setOpen((prev) => !prev);
			event.stopPropagation();
		}, []);

	const loggedIn = useAppSelector(isLoggedIn);
	const navigate = useNavigate();
	const options = React.useMemo(() => {
		const options = [
			{ label: 'Home', path: '/home' },
			{ label: 'About', path: '/about' },
			{ label: 'Puzzlehunt Viewer', path: '/servers' },
		];
		options.push(
			loggedIn
				? { label: 'Logout', path: '/logout' }
				: { label: 'Login', path: '/login' }
		);
		return options;
	}, [loggedIn]);
	return (
		<>
			{open && (
				<Menu className="hamburger-dropdown">
					{...options.map(({ label, path }) => {
						return (
							<MenuItem
								key={label}
								onClick={(event) => {
									navigate(path);
									setOpen(false);
									event.stopPropagation();
								}}
							>
								{label}
							</MenuItem>
						);
					})}
				</Menu>
			)}
			<div className="hamburger">
				<HamburgerIcon open={open} onChange={onChange} />
			</div>
		</>
	);
};

function useSoftDismiss(open: boolean, setOpen: (open: boolean) => void) {
	React.useEffect(() => {
		if (!open) {
			return () => {};
		}

		const onClick = (event: MouseEvent) => {
			if (
				event.target instanceof HTMLElement &&
				event.target.matches('.hamburger *')
			) {
				// Let this be handled by explicit dismiss logic.
				return;
			}
			setOpen(false);
		};
		const onKeyUp = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setOpen(false);
			}
		};

		window.document.addEventListener('keyup', onKeyUp);
		window.document.addEventListener('click', onClick);
		return () => {
			window.document.addEventListener('keyup', onKeyUp);
			window.document.removeEventListener('click', onClick);
		};
	}, [open, setOpen]);
}

const AccountInfo: React.FC<{ includeAvatars: boolean }> = ({
	includeAvatars,
}) => {
	const currentMicrosoftUser = useAppSelector(getMicrosoftUser);
	// https://techcommunity.microsoft.com/t5/apps-on-azure-blog/adding-user-profiles-to-static-web-apps/ba-p/2855234
	// could be useful for more useful microsoft info
	const msftContent = currentMicrosoftUser
		? `Microsoft user: ${currentMicrosoftUser.userDetails}`
		: 'Not logged in to Microsoft.';

	return (
		<div className="account-info">
			{includeAvatars && (
				<>
					<li className="account-list-item">
						<DiscordProfile />
					</li>
					<li className="account-list-item">
						<Card className="nav-bar-card">{msftContent}</Card>
					</li>
				</>
			)}
			<li className="account-list-item">
				<Anchor href="/logout">Logout</Anchor>
			</li>
		</div>
	);
};

const PageNavigation: React.FC = () => {
	return (
		<nav>
			<li>
				<Anchor href="/home">Home</Anchor>
			</li>
			<li>
				<Anchor href="/about">About</Anchor>
			</li>
			<li>
				<Anchor href="/servers">Puzzlehunt Viewer</Anchor>
			</li>
			{/* TODO: include github link here */}
		</nav>
	);
};
