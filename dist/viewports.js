const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
export const VIEWPORT_PRESETS = {
    'mobile-s': { name: 'mobile-s', width: 320, height: 568, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IOS_UA },
    'mobile-m': { name: 'mobile-m', width: 375, height: 812, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IOS_UA },
    'mobile-l': { name: 'mobile-l', width: 425, height: 896, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IOS_UA },
    tablet: { name: 'tablet', width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD_UA },
    laptop: { name: 'laptop', width: 1024, height: 768, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    desktop: { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    'desktop-l': { name: 'desktop-l', width: 1920, height: 1080, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    '4k': { name: '4k', width: 3840, height: 2160, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
};
export function resolveViewport(spec) {
    const preset = VIEWPORT_PRESETS[spec];
    if (preset)
        return preset;
    const match = /^(\d+)x(\d+)(?:x(\d+(?:\.\d+)?))?$/.exec(spec);
    if (!match) {
        throw new Error(`Unknown viewport "${spec}". Use a preset (${Object.keys(VIEWPORT_PRESETS).join(', ')}) or WIDTHxHEIGHT[xSCALE].`);
    }
    const width = Number(match[1]);
    const height = Number(match[2]);
    const deviceScaleFactor = match[3] ? Number(match[3]) : 1;
    return { name: spec, width, height, deviceScaleFactor, isMobile: width < 768, hasTouch: width < 1024 };
}
export function viewportKey(viewport) {
    return `${viewport.name}_${viewport.width}x${viewport.height}`;
}
