"use client";

import { useMemo, useState } from "react";

type Scope = "Enterprise" | "Project";

type Attribute = {
  number: number;
  name: string;
  values: string[];
  active: boolean;
};

const initialEnterpriseAttributes: Attribute[] = [
  { number: 1, name: "Cost Type", values: ["Direct", "Indirect", "Preliminaries"], active: true },
  { number: 2, name: "Workstream", values: ["Civil", "Structures", "Utilities"], active: true },
  { number: 3, name: "Delivery Type", values: ["Self Perform", "Subcontract"], active: true },
  ...Array.from({ length: 17 }, (_, i) => ({ number: i + 4, name: "", values: [], active: false })),
];

const initialProjectAttributes: Attribute[] = [
  { number: 1, name: "Package", values: ["Roadworks", "Bridges", "Drainage"], active: true },
  { number: 2, name: "Area", values: ["North", "Central", "South"], active: true },
  ...Array.from({ length: 18 }, (_, i) => ({ number: i + 3, name: "", values: [], active: false })),
];

export default function Home() {
  const [scope, setScope] = useState<Scope>("Enterprise");
  const [enterpriseAttributes, setEnterpriseAttributes] = useState(initialEnterpriseAttributes);
  const [projectAttributes, setProjectAttributes] = useState(initialProjectAttributes);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [valueInput, setValueInput] = useState("");
  const [search, setSearch] = useState("");

  const attributes = scope === "Enterprise" ? enterpriseAttributes : projectAttributes;
  const setAttributes = scope === "Enterprise" ? setEnterpriseAttributes : setProjectAttributes;

  const selected = attributes.find((attribute) => attribute.number === selectedNumber) ?? null;

  const filteredAttributes = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return attributes;
    return attributes.filter(
      (attribute) =>
        attribute.name.toLowerCase().includes(term) ||
        attribute.values.some((value) => value.toLowerCase().includes(term)),
    );
  }, [attributes, search]);

  function updateSelected(patch: Partial<Attribute>) {
    if (selectedNumber === null) return;
    setAttributes((current) =>
      current.map((attribute) =>
        attribute.number === selectedNumber ? { ...attribute, ...patch } : attribute,
      ),
    );
  }

  function addValue() {
    const value = valueInput.trim();
    if (!selected || !value || selected.values.includes(value)) return;
    updateSelected({ values: [...selected.values, value], active: true });
    setValueInput("");
  }

  function removeValue(value: string) {
    if (!selected) return;
    updateSelected({ values: selected.values.filter((item) => item !== value) });
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
          <div className="flex h-16 items-center border-b border-slate-200 px-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-white">CM</div>
            <div className="ml-3">
              <div className="font-semibold">Cost Management</div>
              <div className="text-xs text-slate-500">Enterprise platform</div>
            </div>
          </div>

          <nav className="flex-1 p-4 text-sm">
            <div className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Workspace</div>
            <button className="mb-1 flex w-full items-center rounded-lg bg-slate-100 px-3 py-2.5 text-left font-medium">Dashboard</button>
            <button className="mb-1 flex w-full items-center rounded-lg px-3 py-2.5 text-left text-slate-600 hover:bg-slate-50">Projects</button>
            <button className="mb-1 flex w-full items-center rounded-lg px-3 py-2.5 text-left text-slate-600 hover:bg-slate-50">Cost Management</button>
            <button className="mb-1 flex w-full items-center rounded-lg bg-slate-900 px-3 py-2.5 text-left font-medium text-white">Attributes</button>
            <button className="mb-1 flex w-full items-center rounded-lg px-3 py-2.5 text-left text-slate-600 hover:bg-slate-50">Users & Access</button>

            <div className="mb-2 mt-8 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Administration</div>
            <button className="mb-1 flex w-full items-center rounded-lg px-3 py-2.5 text-left text-slate-600 hover:bg-slate-50">Enterprise Settings</button>
            <button className="mb-1 flex w-full items-center rounded-lg px-3 py-2.5 text-left text-slate-600 hover:bg-slate-50">Project Settings</button>
          </nav>

          <div className="border-t border-slate-200 p-4">
            <div className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Current enterprise</div>
              <div className="mt-1 font-medium">Example Construction</div>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-5 lg:px-8">
            <div>
              <div className="text-sm font-semibold">Example Construction</div>
              <div className="text-xs text-slate-500">J47 – Eastern Freeway Burke to Tram Alliance</div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <div className="text-sm font-medium">System Admin</div>
                <div className="text-xs text-slate-500">Administrator</div>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold">TA</div>
            </div>
          </header>

          <div className="mx-auto max-w-7xl p-5 lg:p-8">
            <div className="mb-7">
              <div className="text-sm font-medium text-slate-500">Administration</div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">Attribute Management</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                Configure optional value-list attributes that can be used across projects and cost management records.
              </p>
            </div>

            <div className="mb-5 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm">
              <div className="flex gap-1">
                {(["Enterprise", "Project"] as Scope[]).map((item) => (
                  <button
                    key={item}
                    onClick={() => { setScope(item); setSelectedNumber(null); }}
                    className={`rounded-lg px-5 py-2.5 text-sm font-medium transition ${scope === item ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"}`}
                  >
                    {item} Attributes
                  </button>
                ))}
              </div>
            </div>

            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold">{scope} Attributes</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {scope === "Enterprise" ? "Available across all projects in the enterprise." : "Specific to the selected project."}
                  </p>
                </div>
                <div className="relative w-full sm:w-64">
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search attributes..."
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-12 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <div className="col-span-1">Slot</div>
                <div className="col-span-4">Attribute Name</div>
                <div className="col-span-5">Values</div>
                <div className="col-span-2 text-right">Status</div>
              </div>

              {filteredAttributes.map((attribute) => (
                <button
                  key={attribute.number}
                  onClick={() => setSelectedNumber(attribute.number)}
                  className={`grid w-full grid-cols-12 items-center border-b border-slate-100 px-5 py-4 text-left transition hover:bg-slate-50 ${selectedNumber === attribute.number ? "bg-slate-50" : "bg-white"}`}
                >
                  <div className="col-span-1 text-sm font-medium text-slate-400">{String(attribute.number).padStart(2, "0")}</div>
                  <div className="col-span-4 pr-4">
                    <div className={`text-sm font-medium ${attribute.name ? "text-slate-900" : "text-slate-400"}`}>
                      {attribute.name || "Not configured"}
                    </div>
                  </div>
                  <div className="col-span-5 flex flex-wrap gap-1.5 pr-4">
                    {attribute.values.length ? attribute.values.slice(0, 4).map((value) => (
                      <span key={value} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">{value}</span>
                    )) : <span className="text-sm text-slate-400">No values configured</span>}
                    {attribute.values.length > 4 && <span className="px-1 py-1 text-xs text-slate-400">+{attribute.values.length - 4} more</span>}
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${attribute.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {attribute.active ? "Active" : "Available"}
                    </span>
                  </div>
                </button>
              ))}
            </section>

            <div className="mt-5 flex items-center justify-between text-xs text-slate-500">
              <span>20 attribute slots available per {scope.toLowerCase()}.</span>
              <span>V1 supports value-list attributes.</span>
            </div>
          </div>
        </main>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedNumber(null); }}>
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-200 p-6">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Attribute {String(selected.number).padStart(2, "0")}</div>
                <h2 className="mt-1 text-lg font-semibold">Configure attribute</h2>
                <p className="mt-1 text-sm text-slate-500">Define the name and allowed values for this slot.</p>
              </div>
              <button onClick={() => setSelectedNumber(null)} className="rounded-lg px-2 py-1 text-xl text-slate-400 hover:bg-slate-100">×</button>
            </div>

            <div className="space-y-5 p-6">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Attribute name</label>
                <input
                  value={selected.name}
                  onChange={(event) => updateSelected({ name: event.target.value.slice(0, 100), active: event.target.value.trim().length > 0 })}
                  placeholder="e.g. Cost Type"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-medium">Allowed values</label>
                  <span className="text-xs text-slate-400">{selected.values.length} value{selected.values.length === 1 ? "" : "s"}</span>
                </div>
                <div className="flex gap-2">
                  <input
                    value={valueInput}
                    onChange={(event) => setValueInput(event.target.value.slice(0, 100))}
                    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addValue(); } }}
                    placeholder="Add a value..."
                    className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  />
                  <button onClick={addValue} className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800">Add</button>
                </div>
                <div className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-auto">
                  {selected.values.map((value) => (
                    <span key={value} className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-sm text-slate-700">
                      {value}
                      <button onClick={() => removeValue(value)} className="ml-1 text-slate-400 hover:text-slate-700">×</button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div>
                  <div className="text-sm font-medium">Attribute active</div>
                  <div className="text-xs text-slate-500">Inactive attributes remain available for later configuration.</div>
                </div>
                <button
                  onClick={() => updateSelected({ active: !selected.active })}
                  className={`relative h-6 w-11 rounded-full transition ${selected.active ? "bg-slate-900" : "bg-slate-300"}`}
                  aria-label="Toggle attribute active state"
                >
                  <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${selected.active ? "left-6" : "left-1"}`} />
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-200 p-5">
              <button onClick={() => setSelectedNumber(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Close</button>
              <button onClick={() => setSelectedNumber(null)} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">Save changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
