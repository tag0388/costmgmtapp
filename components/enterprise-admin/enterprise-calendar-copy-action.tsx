"use client";

import { useEffect, useMemo, useState } from "react";
import { copyEnterpriseCalendar, EnterpriseCalendar, enterpriseCalendarErrorMessage, listEnterpriseCalendars } from "@/lib/enterprise-calendars";
import { Enterprise, listEnterprises } from "@/lib/enterprises";

export default function EnterpriseCalendarCopyAction({ enterprisePublicId, onCopied }: { enterprisePublicId: string; onCopied?: () => void }) {
  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [calendars, setCalendars] = useState<EnterpriseCalendar[]>([]);
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [calendarName, setCalendarName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const enterprises = await listEnterprises();
      const current = enterprises.find((row) => row.public_id === enterprisePublicId) ?? null;
      setEnterprise(current);
      setCalendars(current ? await listEnterpriseCalendars(current.id) : []);
    })().catch((requestError) => setError(enterpriseCalendarErrorMessage(requestError)));
  }, [enterprisePublicId, open]);

  const source = useMemo(() => calendars.find((row) => row.id === sourceId) ?? null, [calendars, sourceId]);

  function chooseSource(id: string) {
    setSourceId(id);
    const selected = calendars.find((row) => row.id === id);
    if (selected) {
      setCalendarId(`${selected.calendar_id}-COPY`.slice(0, 40));
      setCalendarName(`${selected.calendar_name} Copy`.slice(0, 120));
    }
  }

  async function copy() {
    if (!source) return setError("Select a calendar to copy.");
    if (!calendarId.trim() || !calendarName.trim()) return setError("New Calendar ID and Calendar Name are required.");
    if (calendarId.trim().length > 40 || calendarName.trim().length > 120) return setError("Calendar ID max 40 characters; Calendar Name max 120 characters.");
    setSaving(true); setError("");
    try {
      await copyEnterpriseCalendar(source, calendarId, calendarName);
      setOpen(false); setSourceId(""); setCalendarId(""); setCalendarName("");
      onCopied?.();
      window.location.reload();
    } catch (requestError) { setError(enterpriseCalendarErrorMessage(requestError)); }
    finally { setSaving(false); }
  }

  return <>
    <button className="button secondary" disabled={!enterprise || calendars.length === 0} onClick={() => setOpen(true)}>⧉ Copy Calendar</button>
    {open && <div className="confirm-layer"><button className="confirm-scrim" onClick={() => !saving && setOpen(false)} aria-label="Close copy calendar"/><div className="confirm-dialog" style={{ width: "min(460px,calc(100vw - 28px))", textAlign: "left" }}>
      <h2>Copy Existing Calendar</h2>
      <p style={{ marginBottom: 14 }}>The weekly working pattern and all date exceptions will be copied. You can edit the new calendar independently afterward.</p>
      {error && <div className="form-error">{error}</div>}
      <div className="form-grid">
        <label className="form-field"><span>Source Calendar <b>*</b></span><select value={sourceId} onChange={(event) => chooseSource(event.target.value)} style={{ height: 34, border: "1px solid #dce2ea", borderRadius: 6, padding: "0 10px" }}><option value="">Select calendar…</option>{calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.calendar_id} · {calendar.calendar_name}</option>)}</select></label>
        <label className="form-field"><span>New Calendar ID <b>*</b><small>{calendarId.length}/40</small></span><input maxLength={40} value={calendarId} onChange={(event) => setCalendarId(event.target.value)}/></label>
        <label className="form-field"><span>New Calendar Name <b>*</b><small>{calendarName.length}/120</small></span><input maxLength={120} value={calendarName} onChange={(event) => setCalendarName(event.target.value)}/></label>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 7, marginTop: 18 }}><button className="button secondary" onClick={() => setOpen(false)} disabled={saving}>Cancel</button><button className="button primary" onClick={() => void copy()} disabled={saving}>{saving ? "Copying…" : "Copy Calendar"}</button></div>
    </div></div>}
  </>;
}
