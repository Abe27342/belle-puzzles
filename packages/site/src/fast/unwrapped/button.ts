import { buttonTemplate, ButtonOptions } from '@microsoft/fast-foundation';
import { Button, buttonStyles } from '@microsoft/fast-components';
import { Constructable, css } from '@microsoft/fast-element';

const fastButton = Button.compose<ButtonOptions, Constructable<Button>>({
	baseName: 'button',
	template: buttonTemplate,
	styles: (ctx, def) => css`
		${buttonStyles(ctx, def)}
		.control {
			align-items: center !important;
		}
	`,
});

export const button = fastButton();
