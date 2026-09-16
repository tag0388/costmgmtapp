"use client";

import { provideGlobalGridOptions } from "ag-grid-community";

/*
 * Shared spreadsheet-style interaction defaults for every AG Grid in the app.
 * Read-only columns remain read-only; editable columns gain Excel-like range
 * selection, clipboard paste, fill-handle drag, and undo/redo support.
 */
provideGlobalGridOptions(
  {
    cellSelection: {
      handle: {
        mode: "fill",
        direction: "xy",
        suppressClearOnFillReduction: true,
      },
    },
    undoRedoCellEditing: true,
    undoRedoCellEditingLimit: 50,
  },
  "deep",
);

export default function AgGridGlobalConfig() {
  return null;
}
