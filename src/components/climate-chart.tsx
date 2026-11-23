"use client";

import { Fragment, useId, useState, type PointerEvent } from "react";
import { MONTHS, climateMonthText, formatFahrenheit, formatInches, formatReferenceYears, precipitationScale, sourceHref, temperatureScale, type MonthlyClimate } from "@/lib/typical-weather";
import styles from "./climate-chart.module.css";

/** The month under a pointer, from where it is across the plot's width. */
function monthAt(plot: HTMLElement, clientX: number): number {
  const { left, width } = plot.getBoundingClientRect();
  return Math.min(MONTHS.length - 1, Math.max(0, Math.floor((clientX - left) / width * MONTHS.length)));
}

/**
 * A destination's monthly climate averages as a chart (TRA-135), the same for every destination: its average daily
 * highs and lows in °F as two lines from January to December, over each month's precipitation in inches as a bar on its
 * own axis at the right (TRA-164), with a legend, the averages' source and reference years, and a table of every month.
 * Hovering over a month, tapping it, dragging across the months, or choosing one from the keyboard shows its high, low
 * and precipitation. In a trip, `startMonth` is the month the stay begins, 0 for January, which is chosen at first and
 * stays marked; without one, no month is chosen until someone chooses one. Choosing changes only what the chart shows.
 */
export function ClimateChart({ climate, startMonth }: { climate: MonthlyClimate; startMonth: number | null }) {
  const [chosen, setChosen] = useState(startMonth);
  // The month under a mouse pointer, shown in place of the chosen one until the pointer leaves the chart.
  const [hovered, setHovered] = useState<number | null>(null);
  const group = useId();
  const shown = hovered ?? chosen;
  const scale = temperatureScale(climate.months);
  // The precipitation axis shares the temperature axis's gridlines.
  const precipitation = precipitationScale(climate.months, scale.ticks.length - 1);
  /** A temperature's distance from the top of the plot, as a percentage of its height. */
  const top = (value: number) => (scale.max - value) / (scale.max - scale.min) * 100;
  /** A precipitation total's height above the bottom of the plot, as a percentage of its height. */
  const height = (value: number) => value / precipitation.max * 100;
  /** A month's center, as a percentage of the plot's width. The lines have one unit per month. */
  const left = (index: number) => (index + 0.5) / MONTHS.length * 100;
  const line = (key: "highF" | "lowF") => climate.months.map((month, index) => `${index + 0.5},${top(month[key])}`).join(" ");
  const point = (index: number) => index === shown ? " " + styles.shownPoint : "";
  /** A mouse shows the month it is over. Dragging a finger, pen or pressed mouse across the plot chooses each month it reaches. */
  const follow = (event: PointerEvent<HTMLDivElement>) => {
    const month = monthAt(event.currentTarget, event.clientX);
    if (event.buttons) { setChosen(month); setHovered(null); }
    else if (event.pointerType === "mouse") setHovered(month);
  };
  const href = sourceHref(climate.source);
  return <div className={styles.chart}>
    <ul className={styles.legend}>
      <li><span className={styles.highKey} aria-hidden="true" />Average high (°F)</li>
      <li><span className={styles.lowKey} aria-hidden="true" />Average low (°F)</li>
      <li><span className={styles.precipitationKey} aria-hidden="true" />Precipitation (in)</li>
      {startMonth !== null && <li><span className={styles.stayKey} aria-hidden="true" />Your stay begins</li>}
    </ul>
    <div className={styles.plot}>
      <div className={styles.axis} aria-hidden="true">{scale.ticks.map((tick) => <span key={tick} style={{ top: top(tick) + "%" }}>{tick}°</span>)}</div>
      <div className={styles.area} onPointerMove={follow} onPointerLeave={() => setHovered(null)}>
        {chosen !== null && <span className={styles.band} style={{ left: left(chosen) + "%" }} aria-hidden="true" />}
        {/* The gridlines, then each month's precipitation bar, then the temperature lines over them. */}
        <svg className={styles.lines} viewBox={`0 0 ${MONTHS.length} 100`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
          {scale.ticks.map((tick) => <line key={tick} className={styles.grid} x1={0} x2={MONTHS.length} y1={top(tick)} y2={top(tick)} />)}
        </svg>
        <div className={styles.bars} aria-hidden="true">{climate.months.map((month, index) => <span key={index} className={styles.bar} style={{ left: left(index) + "%", height: height(month.precipitationIn) + "%" }} />)}</div>
        <svg className={styles.lines} viewBox={`0 0 ${MONTHS.length} 100`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
          {hovered !== null && <line className={styles.crosshair} x1={hovered + 0.5} x2={hovered + 0.5} y1={0} y2={100} />}
          <polyline className={styles.high} points={line("highF")} />
          <polyline className={styles.low} points={line("lowF")} />
        </svg>
        <div className={styles.points} aria-hidden="true">{climate.months.map((month, index) => <Fragment key={index}>
          <span className={styles.highPoint + point(index)} style={{ left: left(index) + "%", top: top(month.highF) + "%" }} />
          <span className={styles.lowPoint + point(index)} style={{ left: left(index) + "%", top: top(month.lowF) + "%" }} />
        </Fragment>)}</div>
        {/* Each month is a radio button the height of the plot, so a pointer or finger anywhere in its column chooses it, and the arrow keys move between months. */}
        <div className={styles.months} role="radiogroup" aria-label="Month">{MONTHS.map((name, index) => <label key={name} className={styles.month}>
          <input type="radio" className="sr-only" name={group} checked={chosen === index} onChange={() => { setChosen(index); setHovered(null); }} />
          <span className={index === startMonth ? styles.monthName + " " + styles.stayMonth : styles.monthName} aria-hidden="true"><span className={styles.abbreviation}>{name.slice(0, 3)}</span><span className={styles.initial}>{name[0]}</span></span>
          <span className="sr-only">{climateMonthText(climate, index)}{index === startMonth && ". Your stay begins this month."}</span>
        </label>)}</div>
      </div>
      <div className={styles.axis + " " + styles.precipitationAxis} aria-hidden="true">{precipitation.ticks.map((tick) => <span key={tick} style={{ top: 100 - height(tick) + "%" }}>{formatInches(tick)}</span>)}</div>
    </div>
    <div className={styles.readout}>{shown === null ? <p className={styles.prompt}>Select a month to see its average high, low and precipitation.</p> : <>
      <p className={styles.readoutMonth}>{MONTHS[shown]}{shown === startMonth && <span className={styles.stayNote}>Your stay begins</span>}</p>
      <dl className={styles.values}>
        <div><dt><span className={styles.highKey} aria-hidden="true" />Average high</dt><dd>{formatFahrenheit(climate.months[shown].highF)}</dd></div>
        <div><dt><span className={styles.lowKey} aria-hidden="true" />Average low</dt><dd>{formatFahrenheit(climate.months[shown].lowF)}</dd></div>
        <div><dt><span className={styles.precipitationKey} aria-hidden="true" />Precipitation</dt><dd>{formatInches(climate.months[shown].precipitationIn)}</dd></div>
      </dl>
    </>}</div>
    <p className={styles.source}>Historical averages for {formatReferenceYears(climate)} from {href ? <a href={href} target="_blank" rel="noopener noreferrer">{climate.source}</a> : climate.source}. These are typical conditions from past years, not a forecast.</p>
    <details className={styles.table}>
      <summary>Every month as a table</summary>
      <div className={styles.tableScroll}>
        <table>
          <thead><tr><th scope="col">Month</th><th scope="col">Average high</th><th scope="col">Average low</th><th scope="col">Precipitation</th></tr></thead>
          <tbody>{climate.months.map((month, index) => <tr key={index}><th scope="row">{MONTHS[index]}</th><td>{formatFahrenheit(month.highF)}</td><td>{formatFahrenheit(month.lowF)}</td><td>{formatInches(month.precipitationIn)}</td></tr>)}</tbody>
        </table>
      </div>
    </details>
  </div>;
}
