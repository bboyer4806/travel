import assert from "node:assert/strict";
import test from "node:test";

import { validateMoney, verifyPersistence } from "./budget-fixtures.mjs";

import { currencyDigits, formatCurrency, minorAmountValue, parseMinorAmount } from "../src/lib/money.ts";
test("USD helpers preserve exact cents, symbols, limits, blank and zero",()=>{
 assert.equal(currencyDigits("USD"),2); assert.equal(parseMinorAmount("12.34","USD"),1234);
 assert.equal(parseMinorAmount(".01",null),1); assert.equal(parseMinorAmount("0","USD"),0); assert.equal(parseMinorAmount("",null),null);
 assert.equal(parseMinorAmount("100000000","USD"),10000000000);
 assert.equal(minorAmountValue(12345,"USD"),"123.45"); assert.equal(formatCurrency(12345,"USD"),"$123.45"); assert.equal(formatCurrency(0,"USD"),"$0");
 for(const value of ["-1","1e2","1.001","NaN","100000000.01"]) assert.throws(()=>parseMinorAmount(value,"USD"));
 for(const currency of ["EUR","JPY","KWD","XYZ"]) assert.throws(()=>parseMinorAmount("1",currency));
});
test("miscellaneous validates money and preserves unrelated fields",t=>validateMoney(t,"miscDailyAmount","miscDailyMinor","miscCurrency"));
test("schema 7 upgrade and replay retain miscellaneous estimates and nights",t=>verifyPersistence(t,"miscDailyAmount","miscDailyMinor","miscCurrency",7,["miscDailyMinor","miscCurrency"]));
