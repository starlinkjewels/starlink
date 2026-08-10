import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tag, Printer, Download } from "lucide-react";
import type { BandMode } from "@/lib/band";
import type { LabelPreset } from "@/lib/db";

/** Shared "print jewellery band" modal — pick a label profile + copies, then
 *  Print or Download. Used by both an Order and a Ready Stock item. */
export function BandDialog({ open, onOpenChange, presets, showPrice, onGenerate }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  presets: LabelPreset[];
  showPrice: boolean;
  onGenerate: (preset: LabelPreset, mode: BandMode, copies: number) => void;
}) {
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "");
  const [copies, setCopies] = useState(1);

  // Keep a valid selection when the preset list changes / dialog opens.
  useEffect(() => {
    if (open && !presets.some(p => p.id === presetId)) setPresetId(presets[0]?.id ?? "");
  }, [open, presets, presetId]);

  const go = (mode: BandMode) => {
    const preset = presets.find(p => p.id === presetId) ?? presets[0];
    if (!preset) return;
    onGenerate(preset, mode, copies);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl flex items-center gap-2"><Tag className="h-5 w-5 text-primary" /> Jewellery Band</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1">Pick a label profile, then print it on that label stock or download the PDF.</p>

        <div className="grid gap-2 mt-2 max-h-56 overflow-y-auto">
          {presets.map(p => (
            <button key={p.id} type="button" onClick={() => setPresetId(p.id)}
              className={`flex items-center justify-between gap-3 text-left p-3 rounded-xl border transition-colors ${presetId === p.id ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/50"}`}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-brand-dark truncate">{p.name}</p>
                <p className="text-[11px] text-muted-foreground">{p.style === "tag" ? "Jewellery tag" : "Spec label"}{p.style === "label" && showPrice ? " · price shown" : ""}</p>
              </div>
              <span className="text-[11px] font-mono text-muted-foreground shrink-0">{p.widthMm}×{p.heightMm}mm</span>
            </button>
          ))}
          {presets.length === 0 && <p className="text-xs text-muted-foreground p-3">No label profiles — add one in Settings.</p>}
        </div>

        <div className="flex items-center gap-2 mt-1">
          <Label className="text-xs">Copies</Label>
          <Input type="number" min={1} max={100} value={copies}
            onChange={e => setCopies(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
            className="h-9 w-20 rounded-lg" />
          <span className="text-[11px] text-muted-foreground">one per piece if you like</span>
        </div>

        <div className="flex gap-2 mt-2">
          <Button variant="outline" onClick={() => go("download")} disabled={!presetId} className="flex-1 rounded-xl gap-2">
            <Download className="h-4 w-4" /> Download
          </Button>
          <Button onClick={() => go("print")} disabled={!presetId} className="btn-hero flex-1 rounded-xl gap-2">
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
