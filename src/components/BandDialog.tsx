import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tag, Printer, Download } from "lucide-react";
import type { BandStyle, BandMode } from "@/lib/band";

/** Shared "print jewellery band" modal — pick a tag style + copies, then Print or
 *  Download. Used by both an Order and a Ready Stock item. */
export function BandDialog({ open, onOpenChange, showPrice, onGenerate }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  showPrice: boolean;
  onGenerate: (style: BandStyle, mode: BandMode, copies: number) => void;
}) {
  const [style, setStyle] = useState<BandStyle>("tag");
  const [copies, setCopies] = useState(1);
  const go = (mode: BandMode) => { onGenerate(style, mode, copies); onOpenChange(false); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2"><Tag className="h-5 w-5 text-primary" /> Jewellery Band</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1">Pick a tag style, then print it on label stock or download the PDF.</p>

        <div className="grid grid-cols-2 gap-2 mt-2">
          {([
            ["tag", "Jewellery tag", "Barcode strip · G/L/N weight"],
            ["label", "Spec label", "Barcode + full details" + (showPrice ? " + price" : "")],
          ] as [BandStyle, string, string][]).map(([val, title, desc]) => (
            <button key={val} type="button" onClick={() => setStyle(val)}
              className={`text-left p-3 rounded-xl border transition-colors ${style === val ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/50"}`}>
              <p className="text-sm font-semibold text-brand-dark">{title}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-1">
          <Label className="text-xs">Copies</Label>
          <Input type="number" min={1} max={100} value={copies}
            onChange={e => setCopies(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            className="h-9 w-20 rounded-lg" />
          <span className="text-[11px] text-muted-foreground">one per piece if you like</span>
        </div>

        <div className="flex gap-2 mt-2">
          <Button variant="outline" onClick={() => go("download")} className="flex-1 rounded-xl gap-2">
            <Download className="h-4 w-4" /> Download
          </Button>
          <Button onClick={() => go("print")} className="btn-hero flex-1 rounded-xl gap-2">
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
