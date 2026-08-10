declare module "jsbarcode" {
  interface Options {
    format?: string;
    width?: number;
    height?: number;
    displayValue?: boolean;
    margin?: number;
    background?: string;
    lineColor?: string;
    fontSize?: number;
    text?: string;
  }
  // Renders a barcode into a <canvas> or <svg> element.
  function JsBarcode(element: HTMLCanvasElement | SVGElement, data: string, options?: Options): void;
  export default JsBarcode;
}
