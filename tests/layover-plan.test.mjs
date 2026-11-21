import assert from "node:assert/strict";
import test from "node:test";
import { formatLayoverTime, formatMinutes, formatUtcOffset, layoverPlanDraft, layoverPlanFromDraft, layoverSchedule, MAX_LAYOVER_ACTIVITIES, normalizeLayoverPlan, zonedInstant } from "../src/lib/layover-plan.ts";

// TRA-45: a layover's plan, checked, and its schedule, worked out from what the traveler entered alone.
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"];
const airport = (name, minutes, id = ids[0]) => ({ id, name, place: "", outside: false, minutes, travelMinutes: null, notes: "" });
const outside = (name, minutes, travelMinutes, id) => ({ id, name, place: "", outside: true, minutes, travelMinutes, notes: "" });
const noEstimates = { immigrationMinutes: 0, customsMinutes: 0, securityMinutes: 0, transferMinutes: 0, boardingMinutes: 0, returnMinutes: null, activities: [] };
/** Frankfurt, landing at 7:35 and leaving at 14:20, with estimates for leaving the airport. */
const frankfurt = (overrides = {}) => ({
  timeZone: "Europe/Berlin", arrival: "2027-05-10T07:35", departure: "2027-05-10T14:20",
  immigrationMinutes: 45, customsMinutes: 15, securityMinutes: 45, transferMinutes: 15, boardingMinutes: 30, returnMinutes: 30,
  activities: lunch(40),
  ...overrides,
});
/** Coffee in the airport, then the old town and lunch of `minutes` outside it, then the lounge. */
function lunch(minutes) {
  return [airport("Coffee", 20, ids[0]), outside("Old town", 90, 30, ids[1]), outside("Lunch", minutes, 15, ids[2]), airport("Lounge", 25, ids[3])];
}
/** Each step as the airport's clocks show it: its time, what it is, its minutes, and whether it runs past boarding. */
const steps = (plan) => layoverSchedule(normalizeLayoverPlan(plan)).steps.map((step) => [formatLayoverTime(step.start, plan.timeZone).replace(/\s/g, " "), step.label, step.minutes, step.late]);
const layover = (plan) => layoverSchedule(normalizeLayoverPlan(plan)).layoverMinutes;
const refusal = (message) => (error) => error instanceof Error && error.message === message;

test("a plan's schedule runs in order from landing to departure, deducting airport time, travel and activities, with the time to spare", () => {
  const schedule = layoverSchedule(normalizeLayoverPlan(frankfurt()));
  assert.deepEqual(steps(frankfurt()), [
    ["7:35 AM", "Arriving flight lands", 0, false],
    ["7:35 AM", "Immigration", 45, false],
    ["8:20 AM", "Customs", 15, false],
    ["8:35 AM", "Coffee", 20, false],
    ["8:55 AM", "Travel to Old town", 30, false],
    ["9:25 AM", "Old town", 90, false],
    ["10:55 AM", "Travel to Lunch", 15, false],
    ["11:10 AM", "Lunch", 40, false],
    ["11:50 AM", "Travel back to the airport", 30, false],
    ["12:20 PM", "Security", 45, false],
    ["1:05 PM", "Terminal transfer", 15, false],
    ["1:20 PM", "Lounge", 25, false],
    ["1:45 PM", "Time to spare", 5, false],
    ["1:50 PM", "At the gate for boarding", 30, false],
    ["2:20 PM", "Connecting flight departs", 0, false],
  ]);
  assert.deepEqual({ ...schedule, steps: undefined }, {
    layoverMinutes: 405, airportMinutes: 150, travelMinutes: 75, activityMinutes: 175, spareMinutes: 5, leavesAirport: true, missesFlight: false, steps: undefined,
  }, "405 minutes = 150 at the airport + 75 travelling + 175 of activities + 5 to spare");
  assert.equal(schedule.steps.filter((step) => step.kind === "spare").length, 1);
});

test("a plan that stays in the airport takes its airport time after landing and its activities before the gate, and steps of 0 minutes are left out", () => {
  const plan = frankfurt({ immigrationMinutes: 0, customsMinutes: 0, securityMinutes: 20, transferMinutes: 10, boardingMinutes: 0, returnMinutes: null, activities: [airport("Lounge", 120, ids[0]), airport("Shopping", 30, ids[1])] });
  assert.deepEqual(steps(plan).map(([time, label, minutes]) => [time, label, minutes]), [
    ["7:35 AM", "Arriving flight lands", 0], ["7:35 AM", "Security", 20], ["7:55 AM", "Terminal transfer", 10], ["8:05 AM", "Lounge", 120], ["10:05 AM", "Shopping", 30],
    ["10:35 AM", "Time to spare", 225], ["2:20 PM", "Connecting flight departs", 0],
  ]);
  assert.equal(layoverSchedule(normalizeLayoverPlan(plan)).leavesAirport, false);
  // Without activities or estimates, the whole layover is to spare.
  const empty = layoverSchedule(normalizeLayoverPlan(frankfurt(noEstimates)));
  assert.deepEqual([empty.spareMinutes, empty.steps.map((step) => step.kind)], [405, ["land", "spare", "depart"]]);
});

test("the layover's length follows the airport's time zone across midnight, months, years and changes of the clocks", () => {
  const plan = (timeZone, arrival, departure) => ({ ...noEstimates, timeZone, arrival, departure });
  assert.equal(layover(plan("Asia/Tokyo", "2027-05-10T09:00", "2027-05-10T13:45")), 285, "same day");
  assert.equal(layover(plan("America/Chicago", "2027-05-10T21:40", "2027-05-11T06:05")), 505, "overnight");
  assert.equal(layover(plan("Europe/Paris", "2027-12-31T22:30", "2028-01-01T08:15")), 585, "into the new year");
  assert.equal(layover(plan("Australia/Sydney", "2028-02-28T23:00", "2028-03-01T01:00")), 1560, "across a leap day");
  // The night the clocks go back in London repeats an hour, and the night they go forward in New York skips one.
  assert.equal(layover(plan("Europe/London", "2026-10-24T22:00", "2026-10-25T06:00")), 540);
  assert.equal(layover(plan("America/New_York", "2026-03-08T00:30", "2026-03-08T05:30")), 240);
  // A clock change in another time zone changes nothing: on the night London's go back, Tokyo's stay put.
  assert.equal(layover(plan("Asia/Tokyo", "2026-10-24T22:00", "2026-10-25T06:00")), 480);
  // Zones a half or three quarters of an hour from UTC.
  assert.equal(layover(plan("Asia/Kolkata", "2027-01-15T23:50", "2027-01-16T04:10")), 260);
  assert.equal(formatLayoverTime(zonedInstant("2027-01-15T23:50", "Asia/Kathmandu"), "Asia/Kathmandu").replace(/\s/g, " "), "11:50 PM");
  assert.equal(zonedInstant("2027-01-15T23:50", "Asia/Kathmandu"), Date.UTC(2027, 0, 15, 18, 5), "UTC+5:45");
});

test("the schedule doesn't depend on the time zone of the device or server working it out", () => {
  const saved = process.env.TZ;
  const read = () => JSON.stringify([steps(frankfurt()), layover({ ...noEstimates, timeZone: "Europe/London", arrival: "2026-10-24T22:00", departure: "2026-10-25T06:00" })]);
  try {
    const answers = ["UTC", "Pacific/Auckland", "America/Los_Angeles"].map((zone) => { process.env.TZ = zone; return read(); });
    assert.equal(new Set(answers).size, 1);
  } finally {
    if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved;
  }
});

test("a time the clocks skip is refused, and a time they repeat is read as the first", () => {
  const plan = { ...noEstimates, timeZone: "America/New_York", arrival: "2026-03-08T02:30", departure: "2026-03-08T09:00" };
  assert.equal(zonedInstant("2026-03-08T02:30", "America/New_York"), null);
  assert.throws(() => normalizeLayoverPlan(plan), (error) => /^The clocks in America\/New_York skip Mar 8, 2026, 2:30\sAM, when the arriving flight lands\. Check the time\.$/.test(error.message));
  assert.throws(() => normalizeLayoverPlan({ ...plan, arrival: "2026-03-08T01:00", departure: "2026-03-08T02:15" }), (error) => error.message.includes("when the connecting flight departs"));
  assert.equal(zonedInstant("2026-11-01T01:30", "America/New_York"), Date.UTC(2026, 10, 1, 5, 30), "1:30 AM EDT, the first of the two");
  assert.equal(layover({ ...plan, arrival: "2026-11-01T00:30", departure: "2026-11-01T01:30" }), 60);
});

test("a plan that runs past boarding warns that it could miss the connecting flight, or that it ends after departure, and marks the late steps", () => {
  // Ten more minutes of lunch: the plan reaches the gate 5 minutes after boarding time.
  const late = layoverSchedule(normalizeLayoverPlan(frankfurt({ activities: lunch(50) })));
  assert.deepEqual([late.spareMinutes, late.missesFlight], [-5, false]);
  assert.deepEqual(late.steps.filter((step) => step.late).map((step) => step.label), ["Lounge", "At the gate for boarding"]);
  assert.equal(late.steps.some((step) => step.kind === "spare"), false);
  // An hour more than that ends after departure: the gate and the departure keep their times among the steps they cut into.
  const missed = frankfurt({ activities: lunch(110) });
  const schedule = layoverSchedule(normalizeLayoverPlan(missed));
  assert.deepEqual([schedule.spareMinutes, schedule.missesFlight], [-65, true]);
  assert.deepEqual(steps(missed).slice(-6), [
    ["1:00 PM", "Travel back to the airport", 30, false],
    ["1:30 PM", "Security", 45, true],
    ["1:50 PM", "At the gate for boarding", 30, true],
    ["2:15 PM", "Terminal transfer", 15, true],
    ["2:20 PM", "Connecting flight departs", 0, false],
    ["2:30 PM", "Lounge", 25, true],
  ]);
  // Without a boarding estimate, the plan has until departure.
  const noBoarding = layoverSchedule(normalizeLayoverPlan(frankfurt({ boardingMinutes: 0, activities: lunch(50) })));
  assert.deepEqual([noBoarding.spareMinutes, noBoarding.missesFlight, noBoarding.steps.some((step) => step.kind === "gate")], [25, false, false]);
});

test("a plan is refused unless it is complete and consistent, with a message to show as written", () => {
  const refused = [
    [undefined, "Enter the layover plan, or remove it."],
    [[], "Enter the layover plan, or remove it."],
    [frankfurt({ timeZone: "" }), "Choose the airport's time zone."],
    [frankfurt({ timeZone: "Mars/Olympus_Mons" }), "Choose the airport's time zone."],
    [frankfurt({ timeZone: "+01:00" }), "Choose the airport's time zone."],
    [frankfurt({ arrival: "2027-05-10 07:35" }), "Enter the date and time the arriving flight lands, as the airport's clocks show it."],
    [frankfurt({ arrival: "2027-02-30T07:35" }), "Enter the date and time the arriving flight lands, as the airport's clocks show it."],
    [frankfurt({ departure: "2027-05-10T24:00" }), "Enter the date and time the connecting flight departs, as the airport's clocks show it."],
    [frankfurt({ departure: "2027-05-10T07:35" }), "The connecting flight must depart after the arriving flight lands."],
    [frankfurt({ departure: "2027-05-09T23:00" }), "The connecting flight must depart after the arriving flight lands."],
    [frankfurt({ immigrationMinutes: -1 }), "Immigration must be a whole number of minutes from 0 to 1440. Enter 0 when it doesn't apply."],
    [frankfurt({ boardingMinutes: 1441 }), "Boarding must be a whole number of minutes from 0 to 1440. Enter 0 when it doesn't apply."],
    [frankfurt({ customsMinutes: 2.5 }), "Customs must be a whole number of minutes from 0 to 1440. Enter 0 when it doesn't apply."],
    [frankfurt({ securityMinutes: "45" }), "Security must be a whole number of minutes from 0 to 1440. Enter 0 when it doesn't apply."],
    [frankfurt({ transferMinutes: undefined }), "Terminal transfer must be a whole number of minutes from 0 to 1440. Enter 0 when it doesn't apply."],
    [frankfurt({ activities: undefined }), `A layover plan can have up to ${MAX_LAYOVER_ACTIVITIES} activities.`],
    [frankfurt({ returnMinutes: null, activities: Array.from({ length: 21 }, (_, index) => airport("Walk", 5, `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`)) }), "A layover plan can have up to 20 activities."],
    [frankfurt({ activities: [airport("Coffee", 20, "not-an-id")] }), "An activity has an invalid identifier. Please refresh and try again."],
    [frankfurt({ returnMinutes: null, activities: [airport("Coffee", 20, ids[0]), airport("Tea", 20, ids[0].toUpperCase())] }), "Each activity must have a unique identifier."],
    [frankfurt({ returnMinutes: null, activities: [{ ...airport("Coffee", 20), outside: "no" }] }), "Choose whether each activity is in the airport or outside it."],
    [frankfurt({ returnMinutes: null, activities: [airport(" ", 20)] }), "Enter what each activity is."],
    [frankfurt({ returnMinutes: null, activities: [airport("x".repeat(161), 20)] }), "What an activity is must be 160 characters or fewer."],
    [frankfurt({ returnMinutes: null, activities: [airport("Coffee", 0)] }), "Enter how long each activity takes, in whole minutes from 1 to 1440."],
    [frankfurt({ returnMinutes: null, activities: [{ ...airport("Coffee", 20), travelMinutes: 10 }] }), "Only activities outside the airport have a travel time."],
    [frankfurt({ activities: [outside("Old town", 90, null, ids[0])] }), "Enter how long getting to each activity outside the airport takes, in whole minutes from 0 to 1440."],
    [frankfurt({ activities: [outside("Old town", 90, 30, ids[0]), airport("Coffee", 20, ids[1]), outside("Lunch", 60, 15, ids[2])] }), "Plan the activities outside the airport one after another, in a single trip out of the airport."],
    [frankfurt({ returnMinutes: null }), "Enter how long the travel back to the airport takes, in whole minutes from 0 to 1440."],
    [frankfurt({ returnMinutes: 30, activities: [airport("Coffee", 20)] }), "Only a plan with activities outside the airport travels back to it."],
    [frankfurt({ activities: [{ ...outside("Old town", 90, 30, ids[0]), place: "x".repeat(301) }] }), "Where an activity is must be 300 characters or fewer."],
  ];
  for (const [plan, message] of refused) assert.throws(() => normalizeLayoverPlan(plan), refusal(message), message);
  // A plan's text is trimmed, an activity's optional text may be left out, and null removes the plan.
  const checked = normalizeLayoverPlan(frankfurt({ timeZone: " Europe/Berlin ", activities: [{ id: ids[0], name: "  Old town ", outside: true, minutes: 90, travelMinutes: 30 }] }));
  assert.deepEqual([checked.timeZone, checked.activities], ["Europe/Berlin", [outside("Old town", 90, 30, ids[0])]]);
  assert.equal(normalizeLayoverPlan(null), null);
});

test("a new plan's editor starts with blank times and every estimate at 0, and saves what was entered, without hidden travel", () => {
  const draft = layoverPlanDraft(undefined);
  assert.deepEqual(draft, { timeZone: "", arrival: "", departure: "", immigrationMinutes: "0", customsMinutes: "0", securityMinutes: "0", transferMinutes: "0", boardingMinutes: "0", returnMinutes: "", activities: [] });
  // A saved plan's draft saves the same plan.
  const saved = normalizeLayoverPlan(frankfurt());
  assert.deepEqual(normalizeLayoverPlan(layoverPlanFromDraft(layoverPlanDraft(saved))), saved);
  // An activity moved into the airport loses its travel time, and a plan with none outside it the travel back, though their fields keep what was typed.
  const moved = layoverPlanDraft(saved);
  moved.activities = moved.activities.map((activity) => ({ ...activity, outside: false }));
  const plan = layoverPlanFromDraft(moved);
  assert.deepEqual([plan.returnMinutes, plan.activities.map((activity) => activity.travelMinutes)], [null, [null, null, null, null]]);
  assert.equal(moved.returnMinutes, "30");
  // A blank number is no number, so checking asks for it.
  assert.throws(() => normalizeLayoverPlan(layoverPlanFromDraft({ ...layoverPlanDraft(saved), customsMinutes: " " })), refusal("Customs must be a whole number of minutes from 0 to 1440. Enter 0 when it doesn't apply."));
});

test("lengths and offsets read as people read them", () => {
  assert.deepEqual([0, 45, 60, 65, 405, -50, 1440].map(formatMinutes), ["0 min", "45 min", "1 h", "1 h 5 min", "6 h 45 min", "50 min", "24 h"]);
  const july = Date.UTC(2027, 6, 1), january = Date.UTC(2027, 0, 1);
  assert.deepEqual([["Europe/Berlin", july], ["Europe/Berlin", january], ["Asia/Kolkata", july], ["America/St_Johns", january], ["UTC", july], ["Asia/Kathmandu", july]].map(([zone, at]) => formatUtcOffset(zone, at)),
    ["UTC+2", "UTC+1", "UTC+5:30", "UTC−3:30", "UTC", "UTC+5:45"]);
});
