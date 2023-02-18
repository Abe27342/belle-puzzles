import * as React from 'react';
import { provideReactWrapper } from '@microsoft/fast-react-wrapper';
import { useLinkClickHandler } from 'react-router-dom';
import { designSystem } from './design';
import {
	anchor,
	button,
	treeItem,
	horizontalScroll,
	treeView,
	toolbar,
	combobox,
	option,
	skeleton,
	card,
	menu,
	menuItem,
	textField,
	dialog,
} from './unwrapped';

// Doc on this is here:
// https://www.fast.design/docs/integrations/react
// Should read more up on it later.
// export const Card = wrap(fastCard(), {
// 	name: 'bar',
// 	events: { onClick: 'foo' },
// });

const { wrap } = provideReactWrapper(React, designSystem);
export const HorizontalScroll = wrap(horizontalScroll);
export const TreeItem = wrap(treeItem);
export const TreeView = wrap(treeView);
export const Toolbar = wrap(toolbar);
export const Button = wrap(button);
export const Combobox = wrap(combobox);
export const Option = wrap(option);
export const Skeleton = wrap(skeleton);
export const Card = wrap(card);
export const Menu = wrap(menu);
export const MenuItem = wrap(menuItem);
export const TextField = wrap(textField, { events: { onChange: 'change' } });
export const Dialog = wrap(dialog, {
	events: { onClose: 'close', onCancel: 'cancel' },
});

// This one isn't directly exported so that we can alter its behavior slightly to play nicely with react-router.
// See https://github.com/remix-run/react-router/blob/f3009f5536b6bb3354bfe91d5ff02dd2fae91285/packages/react-router-dom/index.tsx#L368
const FASTAnchor = wrap(anchor);
export const Anchor: React.FC<{
	href: string;
	children:
		| React.ReactElement
		| React.ReactElement[]
		| string
		| string[]
		| JSX.Element
		| JSX.Element[];
	target?: `_${'self' | 'blank' | 'parent' | 'top'}`;
}> = ({ href, children, target }) => {
	const internalOnClick = useLinkClickHandler(href, { target });
	const handleClick = React.useCallback(
		(event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => {
			if (!event.defaultPrevented) {
				internalOnClick(event);
			}
		},
		[internalOnClick]
	);

	return (
		<FASTAnchor href={href} onClick={handleClick} target={target}>
			{children}
		</FASTAnchor>
	);
};
