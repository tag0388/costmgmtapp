"use client";

import { provideGlobalGridOptions } from "ag-grid-community";

/*
 * Shared table/grid standards for every AG Grid in the app.
 * Read-only columns remain read-only; editable columns gain Excel-like range
 * selection, clipboard paste, fill-handle drag, and undo/redo support.
 * Grid density and initial column sizing are also standardised here.
 */
provideGlobalGridOptions(
  {
    rowHeight: 30,
    headerHeight: 34,
    defaultColDef: {
      minWidth: 70,
    },
    autoSizeStrategy: {
      type: "fitCellContents",
      defaultMinWidth: 70,
      defaultMaxWidth: 260,
      skipHeader: false,
    },
    animateColumnResizing: true,
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
