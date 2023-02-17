import * as React from 'react';
import {
	anchorTemplate,
	AnchorOptions,
	buttonTemplate,
	ButtonOptions,
	DesignToken,
	treeItemTemplate,
	TreeItem as FastTreeItem,
	TreeItemOptions,
} from '@microsoft/fast-foundation';
import {
	Anchor as FastAnchor,
	Button as FastButton,
	provideFASTDesignSystem,
	fastCombobox,
	fastOption,
	fastTreeView,
	anchorStyles,
	buttonStyles,
	treeItemStyles,
	fastToolbar,
	fastCard,
	fastHorizontalScroll,
	baseLayerLuminance,
	StandardLuminance,
	fastSkeleton,
	fastMenu,
	fastMenuItem,
	fastTextField,
	baseHeightMultiplier,
	density,
	designUnit,
	neutralFillStealthHover,
	typeRampBaseFontSize,
	fastDialog,
} from '@microsoft/fast-components';
import { provideReactWrapper } from '@microsoft/fast-react-wrapper';
import { Constructable, css } from '@microsoft/fast-element';
import {
	neutralColor,
	accentColor,
	SwatchRGB,
	// baseHeightMultiplier,
	// bodyFont,
	controlCornerRadius,
	// density,
	// designUnit,
	// disabledOpacity,
	// focusStrokeOuter,
	// focusStrokeWidth,
	// neutralFillActive,
	// neutralFillHover,
	neutralFillRecipe,
	// neutralFillRest,
	// neutralFillStealthActive,
	// neutralFillStealthHover,
	// neutralFillStealthRecipe,
	// neutralFillStealthRest,
	// neutralForegroundRest,
	// strokeWidth,
	// typeRampBaseFontSize,
	// typeRampBaseLineHeight,
	// neutralFillRecipe
	// neutralPalette,
} from '@microsoft/fast-components';
import { useLinkClickHandler } from 'react-router-dom';

// https://github.com/microsoft/fast/blob/df9a22c9ffb2d97eeeb3e37ebd98a57b3f892144/examples/design-system-tutorial/src/main.ts
// neutralPalette.withDefault(PaletteRGB.from({ r: 139, g: 137, b: 137 }));
// accentPalette.withDefault(PaletteRGB.from({ r: 0, g: 120, b: 212 }));
// Useful website: https://color.fast.design/
neutralColor.withDefault(
	SwatchRGB.from({ r: 117 / 256, g: 214 / 256, b: 117 / 256 })
);

typeRampBaseFontSize.withDefault('16px');
controlCornerRadius.withDefault(5);
accentColor.withDefault(
	SwatchRGB.from({ r: 6 / 256, g: 45 / 256, b: 77 / 256 })
);

const treeItemPadding = DesignToken.create<string>('tree-item-padding');
treeItemPadding.withDefault('5px');

const fastTreeItem = FastTreeItem.compose<
	TreeItemOptions,
	Constructable<FastTreeItem>
>({
	baseName: 'tree-item',
	template: treeItemTemplate,
	styles: (ctx, def) => css`
		${treeItemStyles(ctx, def)}
		.positioning-region {
			padding: ${treeItemPadding} 0 0 0;
			height: calc(
				(
						(var(--base-height-multiplier) + var(--density)) *
							var(--design-unit) + 1
					) * 1px + 2 * ${treeItemPadding}
			);
		}

		:host([selected])::after {
			top: calc(
				(${baseHeightMultiplier} + ${density}) * ${designUnit} / 4 * 1px +
					2 * ${treeItemPadding}
			);
		}

		:host(:not([disabled])) .positioning-region:hover {
			background: ${neutralFillStealthHover};
			border-radius: 5px;
		}

		:host([selected]) .positioning-region {
			border-radius: 5px;
		}
	`,
	expandCollapseGlyph: `
	<svg
		viewBox="0 0 16 16"
		xmlns="http://www.w3.org/2000/svg"
		class="expand-collapse-glyph"
	>
		<path
			d="M5.00001 12.3263C5.00124 12.5147 5.05566 12.699 5.15699 12.8578C5.25831 13.0167 5.40243 13.1437 5.57273 13.2242C5.74304 13.3047 5.9326 13.3354 6.11959 13.3128C6.30659 13.2902 6.4834 13.2152 6.62967 13.0965L10.8988 8.83532C11.0739 8.69473 11.2153 8.51658 11.3124 8.31402C11.4096 8.11146 11.46 7.88966 11.46 7.66499C11.46 7.44033 11.4096 7.21853 11.3124 7.01597C11.2153 6.81341 11.0739 6.63526 10.8988 6.49467L6.62967 2.22347C6.48274 2.10422 6.30501 2.02912 6.11712 2.00691C5.92923 1.9847 5.73889 2.01628 5.56823 2.09799C5.39757 2.17969 5.25358 2.30817 5.153 2.46849C5.05241 2.62882 4.99936 2.8144 5.00001 3.00369V12.3263Z"
		/>
	</svg>
`,
});

const fastAnchor = FastAnchor.compose<AnchorOptions, Constructable<FastAnchor>>(
	{
		baseName: 'anchor',
		template: anchorTemplate,
		styles: (ctx, def) => css`
			${anchorStyles(ctx, def)}
			.control {
				align-items: center !important;
			}
		`,
	}
);

const fastButton = FastButton.compose<ButtonOptions, Constructable<FastButton>>(
	{
		baseName: 'button',
		template: buttonTemplate,
		styles: (ctx, def) => css`
			${buttonStyles(ctx, def)}
			.control {
				align-items: center !important;
			}
		`,
	}
);

baseLayerLuminance.withDefault(StandardLuminance.LightMode);
const anchor = fastAnchor();
const horizontalScroll = fastHorizontalScroll();
const treeItem = fastTreeItem();
const treeView = fastTreeView();
const toolbar = fastToolbar();
const button = fastButton();
const combobox = fastCombobox();
const option = fastOption();
const skeleton = fastSkeleton();
const card = fastCard();
const menu = fastMenu();
const menuItem = fastMenuItem();
const textField = fastTextField();
const dialog = fastDialog();

const designSystem = provideFASTDesignSystem();
designSystem.register(
	anchor,
	horizontalScroll,
	treeItem,
	treeView,
	toolbar,
	button,
	combobox,
	option,
	skeleton,
	card,
	menu,
	menuItem,
	textField,
	dialog
);

const { wrap } = provideReactWrapper(React, designSystem);

// Doc on this is here:
// https://www.fast.design/docs/integrations/react
// Should read more up on it later.
// export const Card = wrap(fastCard(), {
// 	name: 'bar',
// 	events: { onClick: 'foo' },
// });

// export const Button = wrap(fastButton());
const FASTAnchor = wrap(anchor);
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

// https://github.com/remix-run/react-router/blob/f3009f5536b6bb3354bfe91d5ff02dd2fae91285/packages/react-router-dom/index.tsx#L368
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
