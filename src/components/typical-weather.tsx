"use client";

import { useId, useState } from "react";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { ClimateChart } from "@/components/climate-chart";
import { CLIMATE_LIMITS, MONTHS, monthOf, sourceHref, type MonthlyClimate } from "@/lib/typical-weather";
import type { TripStop, TypicalWeather } from "@/lib/types";
import styles from "./typical-weather.module.css";

type PanelProps = {
  weather: TypicalWeather;
  /** One trip's stay, whose arrival month the monthly chart chooses at first (TRA-135). Outside a trip there is none. */
  stay?: Pick<TripStop, "arrivalDate">;
  disabled: boolean;
  onEdit: () => void;
  onEditClimate: () => void;
  onClearClimate: () => void;
};

export function TypicalWeatherPanel({ weather, stay, disabled, onEdit, onEditClimate, onClearClimate }: PanelProps) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const monthlyId = useId();
  const href = sourceHref(weather.weatherSource);
  const startMonth = monthOf(stay?.arrivalDate ?? null);
  return <section className={styles.panel} aria-label="Typical weather">
    {/* Edit typical weather shows only while the section is open, as its monthly averages' buttons do (TRA-148). */}
    <div className="section-heading"><h4><button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((open) => !open)}>Typical weather<ChevronDown size={18} aria-hidden="true" /></button></h4>{expanded && <button className="button secondary small" disabled={disabled} onClick={onEdit}><Pencil size={15} />Edit typical weather</button>}</div>
    <div id={detailsId} hidden={!expanded}>
      <p className="helper">Manually recorded typical weather or historical averages.</p>
      <dl className={styles.details}>
        <div><dt>Typical high (°F)</dt><dd>{weather.weatherHighF === null ? "Not provided" : `${weather.weatherHighF} °F`}</dd></div>
        <div><dt>Typical low (°F)</dt><dd>{weather.weatherLowF === null ? "Not provided" : `${weather.weatherLowF} °F`}</dd></div>
        <div><dt>Month or travel period</dt><dd>{weather.weatherPeriod || "Not provided"}</dd></div>
        <div><dt>Rainfall notes</dt><dd>{weather.weatherRainfall || "Not provided"}</dd></div>
        <div><dt>Source</dt><dd>{href ? <a href={href} target="_blank" rel="noopener noreferrer">{weather.weatherSource}</a> : weather.weatherSource || "Not provided"}</dd></div>
      </dl>
      {/* Monthly averages (TRA-135) have their own editor and Clear, so saving either keeps the typical weather above. */}
      <section className={styles.monthly} aria-labelledby={monthlyId}>
        <div className={styles.monthlyHeading}><h5 id={monthlyId}>Monthly averages</h5><div className={styles.actions}>
          <button type="button" className="button secondary small" disabled={disabled} onClick={onEditClimate}>{weather.climate ? <Pencil size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}{weather.climate ? "Edit monthly averages" : "Add monthly averages"}</button>
          {weather.climate && <button type="button" className="text-button" disabled={disabled} onClick={onClearClimate}><Trash2 size={14} aria-hidden="true" />Clear<span className="sr-only"> monthly averages</span></button>}
        </div></div>
        {/* A new stay start month chooses that month again. */}
        {weather.climate ? <ClimateChart key={startMonth ?? "none"} climate={weather.climate} startMonth={startMonth} />
          : <p className={styles.empty}>No monthly averages recorded. Add each month’s historical high, low and precipitation from a source, such as a weather service’s climate normals, to chart them.</p>}
      </section>
    </div>
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
      <label className="field"><span>Typical high (°F)</span><input name="weatherHighF" type="number" step="any" value={high} onChange={(event) => setHigh(event.target.value)} placeholder="Not provided" /></label>
      <label className="field"><span>Typical low (°F)</span><input name="weatherLowF" type="number" step="any" value={low} onChange={(event) => setLow(event.target.value)} placeholder="Not provided" /></label>
      <label className="field wide"><span>Month or travel period</span><input name="weatherPeriod" value={period} onChange={(event) => setPeriod(event.target.value)} maxLength={120} placeholder="e.g. January or late December–early January" /><small>Changing destination dates keeps this recorded period and the weather values.</small></label>
      <label className="field wide"><span>Rainfall notes</span><textarea name="weatherRainfall" value={rainfall} onChange={(event) => setRainfall(event.target.value)} maxLength={4000} rows={3} placeholder="Not provided" /></label>
      <label className="field wide"><span>Source name or link</span><input name="weatherSource" value={source} onChange={(event) => setSource(event.target.value)} maxLength={2048} placeholder="Not provided" /></label>
    </div>
    <button type="button" className="text-button" onClick={() => { setHigh(""); setLow(""); setPeriod(""); setRainfall(""); setSource(""); }}>Clear all weather fields</button>
    <p className="helper">Save changes to apply edits or clearing. These values are entered manually. Monthly averages have their own editor and stay as they are.</p>
  </fieldset>;
}

/** Every month's averages, with their source and reference years, all required (TRA-135). Saving replaces the saved record. */
export function MonthlyClimateEditor({ climate, disabled }: { climate: MonthlyClimate | null; disabled: boolean }) {
  const { minF, maxF, maxPrecipitationIn, minYear, maxYear, sourceLength } = CLIMATE_LIMITS;
  return <fieldset className={styles.editor + " wide"} disabled={disabled}>
    <legend>Monthly averages</legend>
    <p className="helper">Enter historical averages for every month from one source, such as a weather service’s climate normals. Travel never looks them up or estimates them. Highs and lows are average daily temperatures in °F; precipitation is the month’s average total in inches.</p>
    <div className="form-grid">
      <label className="field wide"><span>Source name or link</span><input name="climateSource" required maxLength={sourceLength} defaultValue={climate?.source} placeholder="e.g. a weather service’s climate normals, or a link" /></label>
      <label className="field"><span>First reference year</span><input name="climateFirstYear" type="number" className="no-spin-buttons" required min={minYear} max={maxYear} step={1} defaultValue={climate?.firstYear} placeholder="e.g. 1991" /></label>
      <label className="field"><span>Last reference year</span><input name="climateLastYear" type="number" className="no-spin-buttons" required min={minYear} max={maxYear} step={1} defaultValue={climate?.lastYear} placeholder="e.g. 2020" /></label>
    </div>
    <table className={styles.months}>
      <thead><tr><th scope="col">Month</th><th scope="col">High (°F)</th><th scope="col">Low (°F)</th><th scope="col">Precipitation (in)</th></tr></thead>
      <tbody>{MONTHS.map((month, index) => <tr key={month}>
        <th scope="row">{month}</th>
        <td><input name="climateHighF" type="number" className="no-spin-buttons" step="any" required min={minF} max={maxF} aria-label={month + " average high (°F)"} defaultValue={climate?.months[index].highF} /></td>
        <td><input name="climateLowF" type="number" className="no-spin-buttons" step="any" required min={minF} max={maxF} aria-label={month + " average low (°F)"} defaultValue={climate?.months[index].lowF} /></td>
        <td><input name="climatePrecipitationIn" type="number" className="no-spin-buttons" step="any" required min={0} max={maxPrecipitationIn} aria-label={month + " average precipitation (inches)"} defaultValue={climate?.months[index].precipitationIn} /></td>
      </tr>)}</tbody>
    </table>
    <p className="helper">Saving replaces every month, the source and the years. The rest of the typical weather, trip dates and budgets stay as they are.</p>
  </fieldset>;
}
