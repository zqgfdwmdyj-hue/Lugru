import "server-only";
import bwipjs from "bwip-js/node";

/** Code-128-Barcode als SVG (für FNSKU-Etiketten). */
export function code128Svg(text: string): string {
  return bwipjs.toSVG({ bcid: "code128", text, height: 9, scale: 2, includetext: false, paddingwidth: 0, paddingheight: 0 });
}
