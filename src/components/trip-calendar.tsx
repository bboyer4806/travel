"use client";

import { BedDouble, CalendarDays, CircleHelp, Flag, MapPin, Moon } from "lucide-react";
import type { ReactNode } from "react";
import { TransportationIcons } from "@/components/transportation-icons";
import { formatCalendarDate } from "@/lib/trip-dates";
import { MAX_CALENDAR_DAYS, type CalendarDay, type CalendarEvent, type CalendarLeg, type CalendarNight, type TripCalendar, type UnscheduledPart } from "@/lib/trip-calendar";
import styles from "./trip-calendar.module.css";

function nights(count: number): string { return count + (count === 1 ? " night" : " nights"); }
/** A connection as the calendar names it: its saved Transportation text, or Travel without any, and where it leaves and arrives. */
function connection(leg: CalendarLeg): string { return (leg.method || "Travel") + ": " + leg.from + " → " + leg.to; }
const place = <MapPin size={16} aria-hidden="true" />;

/** What one of a day's events says, Day `day`: what happens, any detail, and its icon, a connection's its transportation's. */
function eventLine(event: CalendarEvent, day: number): { icon: ReactNode; title: string; detail: string | null } {
  switch (event.kind) {
    case "arrive": return { icon: place, title: "Arrive in " + event.stay.place, detail: event.stay.nights === null ? "Nights not set yet" : event.stay.nights + "-night stay begins" };
    case "visit": return { icon: place, title: "Visit " + event.stay.place, detail: "Same-day visit, with no nights there" };
    case "stay": return { icon: place, title: "In " + event.stay.place, detail: null };
    case "depart": return { icon: place, title: "Depart " + event.stay.place, detail: null };
    case "travel": return {
      icon: <TransportationIcons method={event.leg.method} className={styles.transportation} />, title: connection(event.leg),
      detail: event.leg.travelNights ? nights(event.leg.travelNights) + " spent traveling · arrives on Day " + (day + event.leg.travelNights) : null,
    };
    case "transit": return { icon: <TransportationIcons method={event.leg.method} className={styles.transportation} />, title: "Still traveling", detail: connection(event.leg) };
    case "end": return { icon: <Flag size={16} aria-hidden="true" />, title: "Arrive in " + event.place, detail: "End of the trip" };
  }
}

/** Where the night after Day `day` is spent, its night of the same number, as its line says: at a stay, traveling, or not known yet. */
function nightLine(night: CalendarNight, day: number): { icon: ReactNode; title: string; detail: string | null; className: string } {
  switch (night.kind) {
    case "stay": return { icon: <BedDouble size={15} aria-hidden="true" />, title: `Night ${day}: ${night.stay.place}`, detail: night.stay.hotel && "Chosen stay: " + night.stay.hotel, className: styles.night };
    case "travel": return { icon: <Moon size={15} aria-hidden="true" />, title: `Night ${day}: Spent traveling`, detail: connection(night.leg), className: `${styles.night} ${styles.traveling}` };
    case "unknown": return { icon: <CircleHelp size={15} aria-hidden="true" />, title: `Night ${day}: Not known yet`, detail: "Depends on the nights set for " + night.stay.place, className: `${styles.night} ${styles.unknown}` };
  }
}

/** A part of the route after a stay whose nights aren't set, as the calendar lists it, without a day. */
function unscheduledLine(part: UnscheduledPart): string {
  if (part.kind === "travel") return connection(part.leg) + (part.leg.travelNights ? " · " + nights(part.leg.travelNights) + " spent traveling" : "");
  return part.stay.place + " · " + (part.stay.nights === null ? "nights not set yet" : nights(part.stay.nights));
}

/** One day: its heading, Day and its number, with its date while the trip has one, what happens, and where its night is spent. */
function Day({ day }: { day: CalendarDay }) {
  const night = day.night && nightLine(day.night, day.number);
  return <li className={styles.day}>
    <h3 className={styles.heading}>Day {day.number}{day.date && <span className={styles.date}><span className="sr-only">, </span>{formatCalendarDate(day.date)}</span>}</h3>
    <ul className={styles.events}>{day.events.map((event, index) => {
      const { icon, title, detail } = eventLine(event, day.number);
      return <li key={index} className={styles.event}>{icon}<span>{title}{detail && <span className={styles.detail}>{detail}</span>}</span></li>;
    })}</ul>
    {night && <p className={night.className}>{night.icon}<span>{night.title}{night.detail && <span className={styles.detail}>{night.detail}</span>}</span></p>}
  </li>;
}

/**
 * A trip's Calendar (TRA-185), read only and the same for everyone who can open the trip: its days in order, Day 1, Day 2
 * and on, each with its date while the trip has a start date, what happens, and where its night is spent, at a stay or
 * traveling. It follows the trip's destinations, their nights and its connections' nights spent traveling, and saves
 * nothing. After a stay whose nights aren't set, it lists the rest of the route without days.
 */
export function TripCalendarSection({ calendar, dated }: { calendar: TripCalendar; dated: boolean }) {
  return <section className={styles.section} aria-labelledby="trip-calendar-heading">
    <div className="section-heading"><div><p className="eyebrow">DAY BY DAY</p><h2 id="trip-calendar-heading">Calendar</h2></div><CalendarDays size={25} strokeWidth={1.3} aria-hidden="true" /></div>
    {calendar.days.length === 0 ? <p className="section-description">Your trip&apos;s days will appear once you add a destination.</p> : <>
      <p className={styles.description}>Each day from your departure to your return, and where each night is spent. It follows each destination&apos;s nights and each connection&apos;s nights spent traveling.{dated ? "" : " Add a start date in Edit trip to see each day’s date."}</p>
      <ol className={styles.days}>{calendar.days.map((day) => <Day key={day.number} day={day} />)}</ol>
      {calendar.unlisted > 0 && <p className={styles.note}>The calendar lists the trip&apos;s first {MAX_CALENDAR_DAYS} days. {calendar.unlisted === 1 ? "1 more day follows." : calendar.unlisted + " more days follow."}</p>}
      {calendar.waitingFor && <div className={styles.waiting}>
        <p className={styles.note}>{calendar.waitingFor.place} has no nights set yet, so the rest of the trip has no days. Set them to add {calendar.unscheduled.length === 1 ? "this" : "these"} to the calendar:</p>
        <ul className={styles.unscheduled}>{calendar.unscheduled.map((part) => <li key={part.kind === "travel" ? part.leg.id : part.stay.stopId}>{unscheduledLine(part)}</li>)}</ul>
      </div>}
    </>}
  </section>;
}
