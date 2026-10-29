import assert from "node:assert/strict";
import test from "node:test";
import { hasUnreadRelease, publishedReleases } from "../src/lib/change-log.ts";
test("published versions sort numerically and same-day releases remain distinct",()=>{
 const entries=[{version:"1.2",date:"2026-10-29",changes:["Second"]},{version:"1.1",date:"2026-10-29",changes:["First"]},{version:"1.10",date:"2026-10-29",changes:["Later"]}];
 assert.deepEqual(publishedReleases(entries).map(x=>x.version),["1.10","1.2","1.1"]);
 assert.equal(hasUnreadRelease("1.2",null),true); assert.equal(hasUnreadRelease("1.2","1.1"),true);
 assert.equal(hasUnreadRelease("1.2","1.2"),false); assert.equal(hasUnreadRelease("1.2","1.10"),false);
 assert.equal(hasUnreadRelease(undefined,null),false);assert.equal(hasUnreadRelease("1.2","bad data"),true);
 const laptop="1.2",phone=null;assert.equal(hasUnreadRelease("1.2",laptop),false);assert.equal(hasUnreadRelease("1.2",phone),true);
});
