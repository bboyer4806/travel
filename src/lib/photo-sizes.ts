import type { PhotoWidths } from "./types";

/**
 * How wide a photo's frame is (TRA-154), as globals.css lays it out: at each of the page's breakpoints, narrowest first,
 * the widest viewport in CSS pixels the width applies to, or null for every wider one, and the width as a CSS length.
 * Browsers choose between a photo and its large version by it and the screen's pixel density, so these follow the CSS.
 */
export type FrameWidths = readonly (readonly [maxViewport: number | null, width: string])[];

/** The main content, at most 1248 pixels wide between margins that narrow on smaller screens. A trip's banner spans it, and a church's card on its Church page nearly does. */
export const PAGE: FrameWidths = [[540, "100vw - 36px"], [780, "100vw - 48px"], [1360, "100vw - 112px"], [null, "1248px"]];
/** A card on All trips or in Destinations: three columns, two from 1080 pixels and one from 540. */
export const CARD: FrameWidths = [[540, "100vw - 36px"], [780, "(100vw - 70px) / 2"], [1080, "(100vw - 134px) / 2"], [1360, "(100vw - 156px) / 3"], [null, "401px"]];
/**
 * Across a destination's card in the main column of its trip's or its own page, beside the budget until 780 pixels. A
 * church's card in the card nearly spans it.
 */
export const MAIN_COLUMN: FrameWidths = [[540, "100vw - 70px"], [780, "100vw - 86px"], [1080, "100vw - 434px"], [1360, "100vw - 494px"], [null, "866px"]];
/** An idea's card on its category's page: two columns, one from 540 pixels. */
export const HALF_PAGE: FrameWidths = [[540, "100vw - 80px"], [780, "(100vw - 64px) / 2 - 38px"], [1360, "(100vw - 135px) / 2 - 48px"], [null, "564px"]];
/** Across an editor dialog, as an idea's or church's details and the crop editors show photos. */
export const DIALOG: FrameWidths = [[540, "100vw - 64px"], [592, "100vw - 88px"], [null, "504px"]];
/** The trip editor's preview of a trip's card, at most 320 pixels wide. */
export const CARD_PREVIEW: FrameWidths = [[384, "100vw - 64px"], [null, "320px"]];
/** A card in a destination's Hotels, Activities or Restaurants carousel. */
export const CAROUSEL_CARD: FrameWidths = [[null, "200px"]];

/**
 * An <img>'s `srcSet` and `sizes` for a photo filling `frame`, zoomed `zoom` times as a trip's headline image can be
 * (TRA-133), offering the photo and its large version at their widths (TRA-154), so browsers load the large version only
 * when the frame shows more pixels than the photo has. A photo without a large version has neither, and loads as it did.
 */
export function photoSizes(photoUrl: string, largeUrl: string, widths: PhotoWidths | null, frame: FrameWidths, zoom = 1): { srcSet?: string; sizes?: string } {
  if (!widths) return {};
  return {
    srcSet: `${photoUrl} ${widths.photo}w, ${largeUrl} ${widths.large}w`,
    sizes: frame.map(([maxViewport, width]) => `${maxViewport === null ? "" : `(max-width: ${maxViewport}px) `}calc((${width}) * ${zoom})`).join(", "),
  };
}
