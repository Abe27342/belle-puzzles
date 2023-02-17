import {
	baseLayerLuminance,
	provideFASTDesignSystem,
	StandardLuminance,
	typeRampBaseFontSize,
} from '@microsoft/fast-components';
import * as unwrappedComponents from './unwrapped';
import {
	neutralColor,
	accentColor,
	SwatchRGB,
	controlCornerRadius,
} from '@microsoft/fast-components';

/**
 * Some other useful design tokens provided by @microsoft/fast-components:
 *   baseHeightMultiplier,
 *   bodyFont,
 *   density,
 *   designUnit,
 *   disabledOpacity,
 *   focusStrokeOuter,
 *   focusStrokeWidth,
 *   neutralFillActive,
 *   neutralFillHover,
 *   neutralFillRecipe,
 *   neutralFillRest,
 *   neutralFillStealthActive,
 *   neutralFillStealthHover,
 *   neutralFillStealthRecipe,
 *   neutralFillStealthRest,
 *   neutralForegroundRest,
 *   strokeWidth,
 *   typeRampBaseFontSize,
 *   typeRampBaseLineHeight,
 *   neutralFillRecipe
 *   neutralPalette
 */

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

baseLayerLuminance.withDefault(StandardLuminance.LightMode);

export const designSystem = provideFASTDesignSystem();
designSystem.register(...Object.keys(unwrappedComponents));
