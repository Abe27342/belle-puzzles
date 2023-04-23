import {
	DesignToken,
	Dialog,
	dialogTemplate,
} from '@microsoft/fast-foundation';
import { dialogStyles } from '@microsoft/fast-components';
import { Constructable, css } from '@microsoft/fast-element';

const treeItemPadding = DesignToken.create<string>('tree-item-padding');
treeItemPadding.withDefault('5px');

const fastDialog = Dialog.compose<any, Constructable<Dialog>>({
	baseName: 'dialog',
	template: dialogTemplate,
	styles: (ctx, def) =>
		css`
			${dialogStyles(ctx, def)}
			@media screen and (max-width: 1200px) {
				.control {
					height: 95%;
					width: 95%;
				}
			}
		`,
});

export const dialog = fastDialog();
