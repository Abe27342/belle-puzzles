import { anchorTemplate, AnchorOptions } from '@microsoft/fast-foundation';
import { Anchor, anchorStyles } from '@microsoft/fast-components';
import { Constructable, css } from '@microsoft/fast-element';

const fastAnchor = Anchor.compose<AnchorOptions, Constructable<Anchor>>({
	baseName: 'anchor',
	template: anchorTemplate,
	styles: (ctx, def) => css`
		${anchorStyles(ctx, def)}
		.control {
			align-items: center !important;
		}
	`,
});

export const anchor = fastAnchor();
