// Jewellery "band" / tag — a small printable label with a Code128 barcode and
// the piece's key specs, one PDF per order (label stock size). Uses jsPDF (already
// a dependency) + JsBarcode rendered to an offscreen canvas.
import { jsPDF } from "jspdf";
import JsBarcode from "jsbarcode";
import { orderTotal, fmtMoney, type Order, type Settings } from "./db";

/** Render a Code128 barcode of `value` as a PNG data URL (crisp, high-res). */
function barcodeDataUrl(value: string): string {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, value, { format: "CODE128", displayValue: false, margin: 0, width: 2, height: 60, background: "#ffffff", lineColor: "#000000" });
  return canvas.toDataURL("image/png");
}

/** One 50×30mm jewellery band label for an order, downloaded as a PDF (which the
 *  user can print on label stock). `copies` prints that many identical labels. */
export function printOrderBand(order: Order, settings: Settings, opts?: { copies?: number }): void {
  const W = 50, H = 30, M = 3;
  const code = order.orderNumber; // scanner value
  const img = barcodeDataUrl(code);
  const showPrice = settings.barcodeBandShowPrice !== false;

  const gross = order.actualGrossWeight ?? order.estimatedGrossWeight;
  const net = order.actualNetWeight ?? order.estimatedNetWeight;
  const dia = order.actualDiamondWeight ?? (order.diamondWeight || undefined);
  const metalLine = `${order.metal}${order.productKarats ? ` ${order.productKarats}` : ""}`;

  const doc = new jsPDF({ unit: "mm", format: [W, H], orientation: "landscape" });
  const copies = Math.max(1, Math.min(50, opts?.copies ?? 1));

  const draw = () => {
    // Barcode
    doc.addImage(img, "PNG", M, M, W - M * 2, 9);
    // Human-readable code + design number
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(0);
    doc.text(`${code}${order.designNumber ? `  #${order.designNumber}` : ""}`, W / 2, 15.5, { align: "center" });
    // Specs
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.4); doc.setTextColor(40);
    doc.text(`${order.jewelleryType} · ${metalLine}`, W / 2, 19.5, { align: "center" });
    const wt: string[] = [];
    if (gross) wt.push(`G ${gross}g`);
    if (net) wt.push(`N ${net}g`);
    if (dia) wt.push(`Dia ${dia}ct`);
    if (wt.length) doc.text(wt.join(" · "), W / 2, 23, { align: "center" });
    if (showPrice && orderTotal(order) > 0) {
      doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(0);
      doc.text(fmtMoney(orderTotal(order)), W / 2, 27.5, { align: "center" });
    }
  };

  for (let i = 0; i < copies; i++) {
    if (i > 0) doc.addPage([W, H], "landscape");
    draw();
  }
  doc.save(`Band-${code}.pdf`);
}
