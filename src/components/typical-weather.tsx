"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import type { TypicalWeather } from "@/lib/types";
import styles from "./typical-weather.module.css";

function sourceLink(source: string): string | undefined {
  try {
    const url = new URL(source);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* Source names are plain text. */ }
}

export function TypicalWeatherPanel({ weather, disabled, onEdit }: { weather: TypicalWeather; disabled: boolean; onEdit: () => void }) {
  const href = sourceLink(weather.weatherSource);
  return <section className={styles.panel} aria-label="Typical weather">
    <div className="section-heading"><h2>Typical weather</h2><button className="button secondary small" disabled={disabled} onClick={onEdit}><Pencil size={15} />Edit typical weather</button></div>
    <p className="helper">Manually recorded typical weather or historical averages.</p>
    <dl className={styles.details}>
      <div><dt>Typical high (°F)</dt><dd>{weather.weatherHighF === null ? "Not provided" : `${weather.weatherHighF} °F`}</dd></div>
      <div><dt>Typical low (°F)</dt><dd>{weather.weatherLowF === null ? "Not provided" : `${weather.weatherLowF} °F`}</dd></div>
      <div><dt>Month or travel period</dt><dd>{weather.weatherPeriod || "Not provided"}</dd></div>
      <div><dt>Rainfall notes</dt><dd>{weather.weatherRainfall || "Not provided"}</dd></div>
      <div><dt>Source</dt><dd>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{weather.weatherSource}</a> : weather.weatherSource || "Not provided"}</dd></div>
    </dl>
  </section>;
}

export function TypicalWeatherEditor({ weather, disabled }: { weather: TypicalWeather; disabled: boolean }) {
  const [high, setHigh] = useState(String(weather.weatherHighF ?? ""));
  const [low, setLow] = useState(String(weather.weatherLowF ?? ""));
  const [period, setPeriod] = useState(weather.weatherPeriod);
  const [rainfall, setRainfall] = useState(weather.weatherRainfall);
  const [source, setSource] = useState(weather.weatherSource);
  return <fieldset className={styles.editor + " wide"} disabled={disabled}>
    <legend>Typical weather / historical averages</legend>
    <p className="helper">All fields are optional. Leave a field blank to clear it. Temperatures are in Fahrenheit; negative values are accepted.</p>
    <div className="form-grid">
      <label className="field"><span>Typical high (°F)</span><input name="weatherHighF" type="number" step="any" value={high} onChange={(event) => setHigh(event.target.value)} placeholder="Not provided" autoFocus /></label>
      <label className="field"><span>Typical low (°F)</span><input name="weatherLowF" type="number" step="any" value={low} onChange={(event) => setLow(event.target.value)} placeholder="Not provided" /></label>
      <label className="field wide"><span>Month or travel period</span><input name="weatherPeriod" value={period} onChange={(event) => setPeriod(event.target.value)} maxLength={120} placeholder="e.g. January or late December–early January" /><small>Changing destination dates keeps this recorded period and the weather values.</small></label>
      <label className="field wide"><span>Rainfall notes</span><textarea name="weatherRainfall" value={rainfall} onChange={(event) => setRainfall(event.target.value)} maxLength={4000} rows={3} placeholder="Not provided" /></label>
      <label className="field wide"><span>Source name or link</span><input name="weatherSource" value={source} onChange={(event) => setSource(event.target.value)} maxLength={2048} placeholder="Not provided" /></label>
    </div>
    <button type="button" className="text-button" onClick={() => { setHigh(""); setLow(""); setPeriod(""); setRainfall(""); setSource(""); }}>Clear all weather fields</button>
    <p className="helper">Save changes to apply edits or clearing. These values are entered manually.</p>
  </fieldset>;
}
