import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity, CircleAlert, Database, Gauge, HeartPulse, Home, Link2,
  List, Pencil, Plus, RefreshCw, Save, Settings, ShieldCheck,
  Syringe, Trash2, Utensils, Wifi, WifiOff, X
} from "lucide-react";
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";

const API_BASE_URL = "https://glucosewatch-backend.vercel.app";
const STORAGE_KEY = "glucosewatch-v2";

const DEFAULT_SETTINGS = {
  unit: "mmol/L",
  durationHours: 4,
  dexcomRegion: "EU",
};

const insulinCatalog = {
  NovoRapid: { kind: "Schnellwirkend", color: "#fb923c", countsForIob: true },
  Toujeo: { kind: "Langwirkend", color: "#a78bfa", countsForIob: false },
};

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function localDateTimeValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDateTime(iso) {
  if (!iso) return "Nicht verfügbar";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function dexcomValueToDisplay(value, sourceUnit, targetUnit) {
  const numeric = Number(value);
  const mgDl = sourceUnit === "mmol/L" ? numeric * 18.0182 : numeric;
  return targetUnit === "mg/dL" ? Math.round(mgDl) : Number((mgDl / 18.0182).toFixed(1));
}

function axisDomain(unit) {
  return unit === "mg/dL" ? [40, 300] : [2.2, 16.7];
}

function displayThreshold(valueMmol, unit) {
  return unit === "mg/dL" ? Math.round(valueMmol * 18.0182) : valueMmol;
}

function trendArrow(trend) {
  const arrows = {
    doubleUp: "↑↑", singleUp: "↑", fortyFiveUp: "↗", flat: "→",
    fortyFiveDown: "↘", singleDown: "↓", doubleDown: "↓↓",
  };
  return arrows[trend] || "→";
}

function trendLabel(trend) {
  const labels = {
    doubleUp: "stark steigend", singleUp: "steigend", fortyFiveUp: "leicht steigend",
    flat: "stabil", fortyFiveDown: "leicht fallend", singleDown: "fallend",
    doubleDown: "stark fallend",
  };
  return labels[trend] || "Trend unbekannt";
}

// Nur Prototyp-Schätzung. Nicht für Therapie- oder Dosierungsentscheidungen.
function remainingLinearIob(dose, doseTime, atTime, durationHours) {
  const elapsedHours = (Number(atTime) - new Date(doseTime).getTime()) / 3600000;
  if (elapsedHours < 0 || elapsedHours >= durationHours) return 0;
  return Number(dose) * (1 - elapsedHours / durationHours);
}

function calculateIob(entries, atTime, durationHours) {
  return entries
    .filter((entry) => entry.type === "insulin" && entry.insulin === "NovoRapid")
    .reduce((sum, entry) => sum + remainingLinearIob(entry.units, entry.timestamp, atTime, durationHours), 0);
}

function usePersistentState() {
  const [state, setState] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return {
        entries: saved?.entries || [],
        settings: { ...DEFAULT_SETTINGS, ...(saved?.settings || {}) },
      };
    } catch {
      return { entries: [], settings: DEFAULT_SETTINGS };
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  return [state, setState];
}

function Badge({ children, tone = "slate" }) {
  const tones = {
    slate: "border-slate-700 bg-slate-800/80 text-slate-300",
    green: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    orange: "border-orange-500/30 bg-orange-500/10 text-orange-300",
    red: "border-red-500/30 bg-red-500/10 text-red-300",
    violet: "border-violet-500/30 bg-violet-500/10 text-violet-300",
    blue: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

function Card({ children, className = "" }) {
  return <section className={`rounded-3xl border border-slate-800 bg-slate-900/85 shadow-xl shadow-black/10 ${className}`}>{children}</section>;
}

function Stat({ icon: Icon, label, value, accent = "text-emerald-400", note }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-slate-500"><Icon size={15} /> {label}</div>
      <div className={`mt-2 text-2xl font-bold ${accent}`}>{value}</div>
      {note && <div className="mt-1 text-xs text-slate-500">{note}</div>}
    </Card>
  );
}

function Field({ label, children }) {
  return <label className="block"><span className="mb-2 block text-sm font-medium text-slate-300">{label}</span>{children}</label>;
}

function Modal({ open, onClose, children }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-slate-700 bg-slate-950 p-5 shadow-2xl sm:rounded-3xl" initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }} onMouseDown={(event) => event.stopPropagation()}>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function EntryModal({ open, onClose, onSave, editing }) {
  const [kind, setKind] = useState("insulin");
  const [form, setForm] = useState({ timestamp: localDateTimeValue(), insulin: "NovoRapid", units: "", description: "", carbs: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setKind(editing.type);
      setForm({
        timestamp: localDateTimeValue(new Date(editing.timestamp)),
        insulin: editing.insulin || "NovoRapid",
        units: editing.units ?? "",
        description: editing.description || "",
        carbs: editing.carbs ?? "",
      });
    } else {
      setKind("insulin");
      setForm({ timestamp: localDateTimeValue(), insulin: "NovoRapid", units: "", description: "", carbs: "" });
    }
    setError("");
  }, [open, editing]);

  function submit(event) {
    event.preventDefault();
    if (!form.timestamp) return setError("Bitte Datum und Uhrzeit angeben.");
    if (new Date(form.timestamp).getTime() > Date.now() + 60000) return setError("Der Zeitpunkt darf nicht in der Zukunft liegen.");
    if (kind === "insulin" && (!(Number(form.units) > 0) || Number(form.units) > 200)) return setError("Bitte eine Insulinmenge zwischen 0,01 und 200 IE eingeben.");
    if (kind === "meal" && (!form.description.trim() || form.carbs === "" || Number(form.carbs) < 0)) return setError("Bitte Beschreibung und Kohlenhydrate angeben.");

    onSave({
      id: editing?.id || uid(),
      type: kind,
      timestamp: new Date(form.timestamp).toISOString(),
      ...(kind === "insulin"
        ? { insulin: form.insulin, units: Number(form.units) }
        : { description: form.description.trim(), carbs: Number(form.carbs) }),
    });
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="mb-5 flex items-center justify-between">
        <div><p className="text-xs uppercase tracking-[0.2em] text-emerald-400">{editing ? "Eintrag bearbeiten" : "Neuer Eintrag"}</p><h2 className="mt-1 text-2xl font-bold">Dokumentation</h2></div>
        <button onClick={onClose} className="rounded-full bg-slate-800 p-2 text-slate-300"><X size={20} /></button>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl bg-slate-900 p-1">
        <button type="button" onClick={() => setKind("insulin")} className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold ${kind === "insulin" ? "bg-orange-500 text-slate-950" : "text-slate-400"}`}><Syringe size={17} /> Insulin</button>
        <button type="button" onClick={() => setKind("meal")} className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold ${kind === "meal" ? "bg-emerald-500 text-slate-950" : "text-slate-400"}`}><Utensils size={17} /> Mahlzeit</button>
      </div>
      <form onSubmit={submit} className="space-y-4">
        {kind === "insulin" ? <>
          <Field label="Insulinart"><select value={form.insulin} onChange={(e) => setForm({ ...form, insulin: e.target.value })} className="input"><option>NovoRapid</option><option>Toujeo</option></select></Field>
          <Field label="Insulinmenge (IE)"><input type="number" min="0.01" max="200" step="0.01" inputMode="decimal" value={form.units} onChange={(e) => setForm({ ...form, units: e.target.value })} className="input" placeholder="z. B. 4,5" /></Field>
          <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3 text-sm text-slate-400">{form.insulin === "NovoRapid" ? "Schnellwirkend: fließt in die Prototyp-IOB-Schätzung ein." : "Langwirkend: wird separat protokolliert und nicht zum NovoRapid-IOB addiert."}</div>
        </> : <>
          <Field label="Mahlzeit oder Beschreibung"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" placeholder="z. B. Frühstück" /></Field>
          <Field label="Kohlenhydrate (g)"><input type="number" min="0" max="1000" step="1" inputMode="decimal" value={form.carbs} onChange={(e) => setForm({ ...form, carbs: e.target.value })} className="input" placeholder="z. B. 45" /></Field>
        </>}
        <Field label="Datum und Uhrzeit"><input type="datetime-local" value={form.timestamp} onChange={(e) => setForm({ ...form, timestamp: e.target.value })} className="input" /></Field>
        {error && <div className="flex gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"><CircleAlert size={18} className="shrink-0" /> {error}</div>}
        <button className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-4 py-4 font-bold text-slate-950"><Save size={19} /> Speichern</button>
      </form>
    </Modal>
  );
}

function Dashboard({ entries, settings, onAdd }) {
  const [range, setRange] = useState(3);
  const [now, setNow] = useState(Date.now());
  const [dexcom, setDexcom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDexcom = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE_URL}/api/glucose?hours=${range}`, { headers: { Accept: "application/json" } });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.description || payload.error || "Dexcom-Daten konnten nicht geladen werden.");
      setDexcom(payload);
    } catch (requestError) {
      setDexcom(null);
      setError(requestError instanceof Error ? requestError.message : "Unbekannter Fehler beim Dexcom-Abruf.");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { loadDexcom(); }, [loadDexcom]);
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 30000);
    const refresh = setInterval(loadDexcom, 5 * 60000);
    return () => { clearInterval(clock); clearInterval(refresh); };
  }, [loadDexcom]);

  const records = dexcom?.records || [];
  const latest = dexcom?.latest || records[records.length - 1] || null;
  const iob = calculateIob(entries, now, settings.durationHours);
  const chartData = records.map((record) => {
    const time = new Date(record.systemTime || record.displayTime).getTime();
    return {
      time,
      glucose: dexcomValueToDisplay(record.value, record.unit || "mg/dL", settings.unit),
      iob: Number(calculateIob(entries, time, settings.durationHours).toFixed(2)),
    };
  }).filter((point) => Number.isFinite(point.time) && Number.isFinite(point.glucose));

  const currentValue = latest ? dexcomValueToDisplay(latest.value, latest.unit || "mg/dL", settings.unit) : "--";
  const visibleInsulin = entries.filter((entry) => entry.type === "insulin" && now - new Date(entry.timestamp).getTime() <= range * 3600000);
  const recentDose = [...entries].filter((entry) => entry.type === "insulin").sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

  return (
    <div className="space-y-4 pb-28">
      <div className="flex items-start justify-between pt-2">
        <div><p className="text-sm text-slate-500">Guten Tag</p><h1 className="text-2xl font-bold">GlucoseWatch</h1></div>
        <div className="flex items-center gap-2"><Badge>{settings.unit}</Badge><button onClick={onAdd} className="grid h-11 w-11 place-items-center rounded-2xl bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20"><Plus size={23} strokeWidth={3} /></button></div>
      </div>

      <Card className="overflow-hidden p-5">
        <div className="flex items-center justify-between">
          <Badge tone="orange">DEXCOM SANDBOX</Badge>
          <button onClick={loadDexcom} disabled={loading} className="flex items-center gap-1.5 text-xs text-slate-400 disabled:opacity-50"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Aktualisieren</button>
        </div>
        {error ? (
          <div className="mt-5 rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
            <div className="flex gap-2 text-sm text-red-300"><WifiOff size={18} className="shrink-0" />{error}</div>
            <a href={`${API_BASE_URL}/api/auth/start`} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-blue-500 px-3 py-2 text-sm font-bold text-white"><Link2 size={16} /> Dexcom neu verbinden</a>
          </div>
        ) : (
          <div className="mt-4 flex items-end justify-between gap-4">
            <div>
              <div className="flex items-baseline gap-3"><span className="text-6xl font-black tracking-tight">{loading && !latest ? "…" : currentValue}</span><span className="text-4xl font-bold text-emerald-400">{latest ? trendArrow(latest.trend) : ""}</span></div>
              <p className="mt-1 text-sm text-slate-400">{settings.unit}{latest?.trend ? ` · ${trendLabel(latest.trend)}` : ""}</p>
              <p className="mt-2 text-xs text-slate-500">Messzeit: {formatDateTime(latest?.systemTime || latest?.displayTime)}</p>
              <p className="mt-1 text-xs text-slate-600">Import: {formatDateTime(dexcom?.fetchedAt)}</p>
            </div>
            <div className="text-right"><p className="text-xs text-slate-500">Aktives Insulin</p><p className="mt-1 text-2xl font-bold text-orange-400">{iob.toFixed(2)} IE</p><div className="mt-2 flex items-center justify-end gap-1 text-xs text-emerald-400"><Wifi size={13} /> verbunden</div></div>
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div><h2 className="font-bold">Verlauf</h2><p className="text-xs text-slate-500">Dexcom-Glukose und aktives Insulin</p></div>
          <div className="flex rounded-xl bg-slate-950 p-1">{[3, 6, 12, 24].map((hours) => <button key={hours} onClick={() => setRange(hours)} className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${range === hours ? "bg-slate-700 text-white" : "text-slate-500"}`}>{hours}h</button>)}</div>
        </div>
        <div className="h-72 w-full">
          {chartData.length ? <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 14, right: 0, left: -18, bottom: 0 }}>
              <defs><linearGradient id="glucoseFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34d399" stopOpacity={0.25} /><stop offset="100%" stopColor="#34d399" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 6" vertical={false} />
              <ReferenceArea yAxisId="glucose" y1={displayThreshold(3.9, settings.unit)} y2={displayThreshold(10, settings.unit)} fill="#10b981" fillOpacity={0.05} />
              <XAxis dataKey="time" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(value) => new Date(value).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={32} />
              <YAxis yAxisId="glucose" domain={axisDomain(settings.unit)} tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="iob" orientation="right" domain={[0, "auto"]} tick={{ fill: "#fb923c", fontSize: 10 }} axisLine={false} tickLine={false} width={28} />
              <Tooltip contentStyle={{ background: "#020617", border: "1px solid #334155", borderRadius: 14 }} labelFormatter={(value) => new Date(value).toLocaleString("de-DE")} formatter={(value, name) => [value, name === "glucose" ? settings.unit : "IOB (IE)"]} />
              <Area yAxisId="glucose" type="monotone" dataKey="glucose" stroke="#34d399" strokeWidth={3} fill="url(#glucoseFill)" dot={false} isAnimationActive={false} />
              <Line yAxisId="iob" type="monotone" dataKey="iob" stroke="#fb923c" strokeWidth={2.5} dot={false} isAnimationActive={false} />
              {visibleInsulin.map((entry) => {
                const target = new Date(entry.timestamp).getTime();
                const point = chartData.reduce((best, item) => Math.abs(item.time - target) < Math.abs(best.time - target) ? item : best, chartData[0]);
                return <ReferenceDot key={entry.id} yAxisId="glucose" x={target} y={point.glucose} r={5} fill={insulinCatalog[entry.insulin].color} stroke="#020617" strokeWidth={2} />;
              })}
            </ComposedChart>
          </ResponsiveContainer> : <div className="grid h-full place-items-center text-sm text-slate-500">{loading ? "Dexcom-Daten werden geladen…" : "Keine Glukosewerte verfügbar"}</div>}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400"><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-emerald-400" />Glukose</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-orange-400" />IOB</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-violet-400" />Insulingabe</span></div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Stat icon={Syringe} label="Letzte Gabe" value={recentDose ? `${recentDose.units} IE` : "Keine"} accent="text-orange-400" note={recentDose ? `${recentDose.insulin} · ${formatDateTime(recentDose.timestamp)}` : "Noch nicht dokumentiert"} />
        <Stat icon={Gauge} label="Wirkdauer" value={`${settings.durationHours} Std.`} note="Prototyp-Profil" />
      </div>
      <div className="flex gap-3 rounded-3xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs leading-5 text-amber-200/80"><CircleAlert size={19} className="shrink-0" /><p>Sandbox-Prototyp, kein Medizinprodukt. Dexcom-Werte und lineare IOB-Schätzung dürfen nicht für Therapie- oder Dosierungsentscheidungen verwendet werden.</p></div>
    </div>
  );
}

function Logbook({ entries, onEdit, onDelete, onAdd }) {
  const sorted = [...entries].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return (
    <div className="space-y-4 pb-28">
      <div className="flex items-end justify-between pt-2"><div><p className="text-sm text-slate-500">Dokumentation</p><h1 className="text-2xl font-bold">Protokoll</h1></div><button onClick={onAdd} className="flex items-center gap-2 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-bold text-slate-950"><Plus size={18} /> Neu</button></div>
      {sorted.length === 0 ? <Card className="grid place-items-center px-6 py-16 text-center"><div className="rounded-2xl bg-slate-800 p-4 text-slate-400"><List size={28} /></div><h2 className="mt-4 font-bold">Noch keine Einträge</h2><p className="mt-1 max-w-xs text-sm text-slate-500">Dokumentiere Insulin oder eine Mahlzeit über den Plus-Button.</p></Card> : sorted.map((entry) => {
        const insulin = entry.type === "insulin";
        return <motion.div layout key={entry.id} className="rounded-3xl border border-slate-800 bg-slate-900 p-4"><div className="flex items-start gap-3"><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${insulin ? "bg-orange-500/10 text-orange-400" : "bg-emerald-500/10 text-emerald-400"}`}>{insulin ? <Syringe size={21} /> : <Utensils size={21} />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{insulin ? entry.insulin : entry.description}</h3>{insulin && <Badge tone={entry.insulin === "Toujeo" ? "violet" : "orange"}>{insulinCatalog[entry.insulin].kind}</Badge>}</div><p className="mt-1 text-sm text-slate-400">{insulin ? `${entry.units} IE` : `${entry.carbs} g Kohlenhydrate`}</p><p className="mt-2 text-xs text-slate-600">{formatDateTime(entry.timestamp)}</p></div><div className="flex gap-1"><button onClick={() => onEdit(entry)} className="rounded-xl p-2 text-slate-500 hover:bg-slate-800 hover:text-white"><Pencil size={17} /></button><button onClick={() => onDelete(entry.id)} className="rounded-xl p-2 text-slate-500 hover:bg-red-500/10 hover:text-red-400"><Trash2 size={17} /></button></div></div></motion.div>;
      })}
    </div>
  );
}

function SettingsPage({ settings, onSettings, onClear }) {
  const [confirmClear, setConfirmClear] = useState(false);
  function startDexcomLogin() { window.location.href = `${API_BASE_URL}/api/auth/start`; }
  return (
    <div className="space-y-4 pb-28">
      <div className="pt-2"><p className="text-sm text-slate-500">Konfiguration</p><h1 className="text-2xl font-bold">Einstellungen</h1></div>
      <Card className="p-5"><div className="mb-5 flex items-center gap-3"><div className="rounded-2xl bg-orange-500/10 p-3 text-orange-400"><Activity size={22} /></div><div><h2 className="font-bold">IOB-Berechnung</h2><p className="text-xs text-slate-500">Für NovoRapid</p></div></div><Field label="Insulin-Wirkdauer"><select className="input" value={settings.durationHours} onChange={(e) => onSettings({ durationHours: Number(e.target.value) })}>{[2, 3, 4, 5, 6, 8].map((hours) => <option key={hours} value={hours}>{hours} Stunden</option>)}</select></Field><p className="mt-3 text-xs leading-5 text-amber-300/80">Aktuell lineare Prototyp-Schätzung. Nicht für Dosierungsentscheidungen geeignet.</p></Card>
      <Card className="p-5"><div className="mb-5 flex items-center gap-3"><div className="rounded-2xl bg-emerald-500/10 p-3 text-emerald-400"><Gauge size={22} /></div><div><h2 className="font-bold">Anzeige</h2><p className="text-xs text-slate-500">Glukoseeinheit</p></div></div><div className="grid grid-cols-2 gap-2">{["mmol/L", "mg/dL"].map((unit) => <button key={unit} onClick={() => onSettings({ unit })} className={`rounded-2xl border px-4 py-3 text-sm font-bold ${settings.unit === unit ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-slate-800 text-slate-500"}`}>{unit}</button>)}</div></Card>
      <Card className="p-5"><div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-3"><div className="rounded-2xl bg-blue-500/10 p-3 text-blue-400"><Link2 size={22} /></div><div><h2 className="font-bold">Dexcom-Konto</h2><p className="text-xs text-slate-500">Sandbox über sicheres Vercel-Backend</p></div></div><Badge tone="green">Verbunden</Badge></div><div className="rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 text-sm leading-6 text-slate-300"><div className="mb-2 flex items-center gap-2 font-semibold text-white"><ShieldCheck size={18} className="text-emerald-400" /> OAuth über Dexcom</div>GlucoseWatch speichert keine Dexcom-Passwörter. Access- und Refresh-Token werden verschlüsselt im Backend gespeichert.</div><button onClick={startDexcomLogin} className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-500 px-4 py-3 font-bold text-white"><RefreshCw size={18} /> Dexcom erneut verbinden</button></Card>
      <Card className="p-5"><div className="mb-5 flex items-center gap-3"><div className="rounded-2xl bg-violet-500/10 p-3 text-violet-400"><Database size={22} /></div><div><h2 className="font-bold">Datenverwaltung</h2><p className="text-xs text-slate-500">Insulin und Mahlzeiten lokal im Browser</p></div></div>{confirmClear ? <div className="space-y-3"><p className="text-sm text-red-300">Alle lokalen Einträge und Einstellungen löschen?</p><div className="grid grid-cols-2 gap-2"><button onClick={() => setConfirmClear(false)} className="rounded-2xl border border-slate-700 px-4 py-3 font-semibold text-slate-300">Abbrechen</button><button onClick={() => { onClear(); setConfirmClear(false); }} className="rounded-2xl bg-red-500 px-4 py-3 font-bold">Löschen</button></div></div> : <button onClick={() => setConfirmClear(true)} className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/5 px-4 py-3 font-semibold text-red-300"><Trash2 size={18} /> Lokale Daten löschen</button>}</Card>
      <Card className="p-5"><div className="flex items-center gap-3"><div className="rounded-2xl bg-slate-800 p-3 text-slate-400"><HeartPulse size={22} /></div><div><h2 className="font-bold">Apple Watch vorbereitet</h2><p className="mt-1 text-sm text-slate-500">Die native iPhone- und watchOS-Integration folgt in einer späteren Phase.</p></div></div></Card>
    </div>
  );
}

function Navigation({ tab, setTab }) {
  const items = [{ id: "dashboard", label: "Dashboard", icon: Home }, { id: "log", label: "Protokoll", icon: List }, { id: "settings", label: "Einstellungen", icon: Settings }];
  return <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-xl border-t border-slate-800 bg-slate-950/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl sm:bottom-4 sm:rounded-3xl sm:border"><div className="grid grid-cols-3 gap-1">{items.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setTab(id)} className={`flex flex-col items-center gap-1 rounded-2xl px-2 py-2.5 text-[11px] font-semibold ${tab === id ? "bg-emerald-500/10 text-emerald-400" : "text-slate-600"}`}><Icon size={20} />{label}</button>)}</div></nav>;
}

export default function App() {
  const [data, setData] = usePersistentState();
  const [tab, setTab] = useState("dashboard");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  function saveEntry(entry) {
    setData((current) => ({ ...current, entries: [...current.entries.filter((item) => item.id !== entry.id), entry] }));
  }
  function deleteEntry(id) {
    if (!window.confirm("Eintrag wirklich löschen?")) return;
    setData((current) => ({ ...current, entries: current.entries.filter((item) => item.id !== id) }));
  }
  function openAdd() { setEditing(null); setModalOpen(true); }
  function openEdit(entry) { setEditing(entry); setModalOpen(true); }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <style>{`.input{width:100%;border:1px solid #334155;background:#0f172a;color:#f8fafc;border-radius:1rem;padding:.9rem 1rem;outline:none}.input:focus{border-color:#10b981;box-shadow:0 0 0 3px rgba(16,185,129,.12)}select.input{appearance:auto}button{touch-action:manipulation}`}</style>
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_right,rgba(16,185,129,0.08),transparent_34%),radial-gradient(circle_at_bottom_left,rgba(249,115,22,0.06),transparent_28%)]" />
      <main className="relative mx-auto max-w-xl px-4 py-4 sm:py-8">
        {tab === "dashboard" && <Dashboard entries={data.entries} settings={data.settings} onAdd={openAdd} />}
        {tab === "log" && <Logbook entries={data.entries} onEdit={openEdit} onDelete={deleteEntry} onAdd={openAdd} />}
        {tab === "settings" && <SettingsPage settings={data.settings} onSettings={(patch) => setData((current) => ({ ...current, settings: { ...current.settings, ...patch } }))} onClear={() => setData({ entries: [], settings: DEFAULT_SETTINGS })} />}
      </main>
      <Navigation tab={tab} setTab={setTab} />
      <EntryModal open={modalOpen} onClose={() => setModalOpen(false)} onSave={saveEntry} editing={editing} />
    </div>
  );
}
