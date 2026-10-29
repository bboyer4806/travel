import assert from "node:assert/strict";
import test from "node:test";
import { calculateHotelEstimate } from "../src/lib/budget.ts";
import { verifyPersistence } from "./budget-fixtures.mjs";

test("schema 8 hotel estimate upgrade and replay preserve dates, choices, and routes", t=>verifyPersistence(t,"hotelNightlyAmount","hotelNightlyMinor","hotelCurrency",8,["hotelNightlyMinor","hotelCurrency"]));
test("an unsafe hotel subtotal is never displayed as exact money",()=>assert.equal(calculateHotelEstimate({nights:3,hotelNightlyMinor:Number.MAX_SAFE_INTEGER,hotelCurrency:"USD"}).subtotalMinor,null));
