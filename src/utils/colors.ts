/**
 * Calculate the relative luminance of a color according to WCAG 2.0
 * @param hex - Hex color string (e.g., '#60A5FA')
 * @returns Relative luminance value between 0 and 1
 */
function getRelativeLuminance(hex: string): number {
    // Remove # if present
    const color = hex.replace('#', '');

    // Parse RGB values
    const r = parseInt(color.substring(0, 2), 16) / 255;
    const g = parseInt(color.substring(2, 4), 16) / 255;
    const b = parseInt(color.substring(4, 6), 16) / 255;

    // Apply sRGB to linear RGB conversion
    const toLinear = (c: number) => {
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };

    const rLinear = toLinear(r);
    const gLinear = toLinear(g);
    const bLinear = toLinear(b);

    // Calculate relative luminance
    return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
}

/**
 * Calculate contrast ratio between two colors according to WCAG 2.0
 * @param color1 - First hex color
 * @param color2 - Second hex color
 * @returns Contrast ratio between 1 and 21
 */
function getContrastRatio(color1: string, color2: string): number {
    const lum1 = getRelativeLuminance(color1);
    const lum2 = getRelativeLuminance(color2);

    const lighter = Math.max(lum1, lum2);
    const darker = Math.min(lum1, lum2);

    return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Determines whether to use white or black text on a colored background
 * by calculating which provides the highest contrast ratio.
 * Target: at least 4.5:1 (WCAG AA standard for normal text)
 * @param backgroundColor - Hex color of the background
 * @returns 'white' or 'black' - whichever has the highest contrast ratio
 */
export function getTextColorForBackground(backgroundColor: string): 'white' | 'black' {
    const whiteContrast = getContrastRatio(backgroundColor, '#FFFFFF');
    const blackContrast = getContrastRatio(backgroundColor, '#000000');

    // Return the color with the highest contrast ratio
    // If equal, prefer white text
    return whiteContrast >= blackContrast ? 'white' : 'black';
}