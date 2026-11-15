import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { feedbackIssue, validateFeedback, FEEDBACK_FAILURE, FEEDBACK_RETRY } from "../src/lib/feedback.ts";
import { createFeedbackGuard, sameOriginFeedback } from "../src/lib/feedback-guard.ts";
import { createFeedbackHandler } from "../src/lib/feedback-handler.ts";
import { FeedbackDeliveryError, sendJiraFeedback } from "../src/lib/jira-feedback.ts";

const feedback = (message="A useful improvement")=>({message,page:"/trips/demo?tab=budget",browser:"Test browser",viewport:"390 × 844"});
const env={NODE_ENV:"test",JIRA_URL:"http://127.0.0.1:3010",JIRA_EMAIL:"stand-in@example.test",JIRA_API_TOKEN:"test-token"};
const basic="Basic "+Buffer.from("stand-in@example.test:test-token").toString("base64");
const created=()=>Response.json({id:"1",key:"TRA-STUB"},{status:201});
/** Rejects with a delivery error whose fixed message matches and that says whether Jira certainly created nothing. */
async function refused(promise,message,nothingCreated){
  await assert.rejects(promise,(error)=>{
    assert.ok(error instanceof FeedbackDeliveryError,String(error)); assert.match(error.message,message); assert.equal(error.nothingCreated,nothingCreated,error.message);
    return true;
  });
}
/** The signed-in route's handler, with a clock the test moves and Jira's answers from the given fetch. */
function feedbackEndpoint(fetch,settings=env){
  const clock={time:0}; const handler=createFeedbackHandler({guard:createFeedbackGuard(()=>clock.time),send:(input)=>sendJiraFeedback(input,{env:settings,fetch})});
  const call=(account,body)=>handler(new Request("https://travel.example/api/feedback",{method:"POST",headers:{origin:"https://travel.example","content-type":"application/json"},body:JSON.stringify(body)}),account);
  return {
    clock, open:(account)=>call(account,{action:"open"}),
    /** Opens the sheet, waits for its token to mature and sends, as the sheet does. */
    async send(account){
      const opened=await call(account,{action:"open"}); assert.equal(opened.status,200,"token for "+account);
      const {token}=await opened.json(); clock.time+=1100;
      return call(account,{...feedback(),token,website:""});
    },
  };
}
test("origin checks work behind Dokku without trusting forwarded headers",()=>{
  const request=(headers)=>new Request("http://0.0.0.0:80/api/feedback",{headers:{host:"travel.example",origin:"https://travel.example",...headers}});
  assert.equal(sameOriginFeedback(request({})),true);
  assert.equal(sameOriginFeedback(request({origin:"https://evil.example","x-forwarded-host":"evil.example"})),false);
  assert.equal(sameOriginFeedback(request({"sec-fetch-site":"cross-site"})),false);
});
test("feedback normalizes text and validates blank, length and Unicode title boundaries",()=>{
  for(const value of [null,{},feedback("  \r\n ")]) assert.throws(()=>validateFeedback(value),/Enter your feedback/);
  assert.equal(validateFeedback(feedback(" \r\n first\rsecond \r\n ")).message,"first\nsecond");
  assert.equal(validateFeedback(feedback("a".repeat(2000))).message.length,2000);
  assert.throws(()=>validateFeedback(feedback("a".repeat(2001))),/2,000/);
  const input=validateFeedback(feedback("😀".repeat(81)+"\n<script>alert(1)</script>"));
  const issue=feedbackIssue(input);
  assert.equal(issue.fields.summary,"Feedback: "+"😀".repeat(80));
  assert.deepEqual(issue.fields.project,{key:"TRA"}); assert.deepEqual(issue.fields.issuetype,{name:"Task"}); assert.deepEqual(issue.fields.labels,["user-feedback"]);
  assert.deepEqual(Object.keys(issue.fields).sort(),["description","issuetype","labels","project","summary"]);
  assert.equal(issue.fields.description.content[1].content[0].text,"<script>alert(1)</script>");
  assert.match(JSON.stringify(issue),/Page: \/trips\/demo\?tab=budget/);
  assert.match(JSON.stringify(issue),/Browser: Test browser/); assert.match(JSON.stringify(issue),/Window: 390/);
});

test("Jira confirmation, errors, redirects, missing config and timeout use one request only",async()=>{
  let calls=0;
  await sendJiraFeedback(feedback(),{env,fetch:async(url,options)=>{
    calls++; assert.equal(url.href,"http://127.0.0.1:3010/rest/api/3/issue");
    assert.equal(options.method,"POST"); assert.equal(options.redirect,"error");
    assert.equal(options.headers.Authorization,basic);
    assert.deepEqual(JSON.parse(options.body),feedbackIssue(feedback()));
    return created();
  }});
  assert.equal(calls,1);
  // Jira certainly created nothing only when it refused the request (4xx) or couldn't handle it (503).
  for(const [status,nothingCreated] of [[200,false],[302,false],[400,true],[401,true],[403,true],[404,true],[429,true],[500,false],[502,false],[503,true],[504,false]]) {
    let attempts=0; await refused(sendJiraFeedback(feedback(),{env,fetch:async()=>{attempts++;return new Response("failure",{status});}}),new RegExp(`^Jira answered HTTP ${status}[.;]`),nothingCreated); assert.equal(attempts,1);
  }
  await refused(sendJiraFeedback(feedback(),{env,fetch:async()=>Response.json({},{status:201})}),/incomplete/,false);
  await refused(sendJiraFeedback(feedback(),{env,fetch:async()=>new Response("<html>",{status:201})}),/incomplete/,false);
  await refused(sendJiraFeedback(feedback(),{env:{}}),/^Missing feedback settings: JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN$/,true);
  await refused(sendJiraFeedback(feedback(),{env:{...env,JIRA_API_TOKEN:" \n"}}),/^Missing feedback settings: JIRA_API_TOKEN$/,true);
  await refused(sendJiraFeedback(feedback(),{env:{...env,JIRA_URL:"https://example.atlassian.net"}}),/stand-in/,true);
  const keepAlive=setTimeout(()=>{},500);
  try { await refused(sendJiraFeedback(feedback(),{env,timeoutMs:10,fetch:async(_,options)=>new Promise((_,reject)=>options.signal.addEventListener("abort",()=>reject(options.signal.reason)))}),/^Jira did not answer in time\.$/,false); }
  finally {clearTimeout(keepAlive);}
});

test("bad JIRA_URL values are named in the error without their contents and never contacted",async()=>{
  const fetch=async()=>{throw new Error("Jira must not be contacted");};
  for(const JIRA_URL of ["not a url","https://user:secret@example.atlassian.net","http://example.atlassian.net","https://example.atlassian.net/?project=secret","ftp://127.0.0.1"]) {
    await assert.rejects(sendJiraFeedback(feedback(),{env:{...env,NODE_ENV:"production",JIRA_URL},fetch}),(error)=>{
      assert.equal(error.message,"Invalid JIRA_URL setting."); assert.equal(error.nothingCreated,true); return true;
    });
  }
});

test("a refused connection or unknown host created nothing, but a dropped connection may have",async()=>{
  const failing=(code)=>async()=>{throw new TypeError("fetch failed",{cause:Object.assign(new Error("connect failed to secret.example"),code?{code}:{})});};
  await refused(sendJiraFeedback(feedback(),{env,fetch:failing("ECONNREFUSED")}),/^The request to Jira failed \(ECONNREFUSED\)\.$/,true);
  await refused(sendJiraFeedback(feedback(),{env,fetch:failing("ENOTFOUND")}),/^The request to Jira failed \(ENOTFOUND\)\.$/,true);
  await refused(sendJiraFeedback(feedback(),{env,fetch:failing("ECONNRESET")}),/^The request to Jira failed \(ECONNRESET\)\.$/,false);
  await refused(sendJiraFeedback(feedback(),{env,fetch:failing()}),/^The request to Jira failed\.$/,false);
  // Node's own fetch, against a loopback port nothing listens on.
  const closed=createServer(); await new Promise((resolve)=>closed.listen(0,"127.0.0.1",resolve));
  const {port}=closed.address(); await new Promise((resolve)=>closed.close(resolve));
  await refused(sendJiraFeedback(feedback(),{env:{...env,JIRA_URL:`http://127.0.0.1:${port}`}}),/^The request to Jira failed \(ECONNREFUSED\)\.$/,true);
});

test("invisible protection rejects replay, bot fields, too-fast sends and bursts across accounts",()=>{
  let time=0; const guard=createFeedbackGuard(()=>time);
  let token=guard.issue("one"); assert.equal(guard.consume("one",token,""),null);
  token=guard.issue("one"); time+=1100; assert.equal(guard.consume("other",token,""),null); assert.equal(guard.consume("one",token,"spam"),null);
  for(let i=0;i<3;i++){token=guard.issue("one");time+=1100;assert.equal(typeof guard.consume("one",token,""),"function");assert.equal(guard.consume("one",token,""),null);}
  token=guard.issue("one");time+=1100;assert.equal(guard.consume("one",token,""),null,"three sends an hour for each account");
  for(let i=0;i<2;i++){token=guard.issue("fresh"+i);time+=1100;assert.equal(typeof guard.consume("fresh"+i,token,""),"function");}
  token=guard.issue("another");time+=1100;assert.equal(guard.consume("another",token,""),null,"the shared cap of five sends a minute applies across accounts");
  time+=3600001; token=guard.issue("one");time+=1100;assert.equal(typeof guard.consume("one",token,""),"function");
  token=guard.issue("expiry");time+=16*60000;assert.equal(guard.consume("expiry",token,""),null);
});

test("a returned send slot no longer counts against the account's or the shared limits",()=>{
  let time=0; const guard=createFeedbackGuard(()=>time);
  const take=(account)=>{const token=guard.issue(account);time+=1100;return guard.consume(account,token,"");};
  for(let i=0;i<5;i++) take("one")?.();
  for(let i=0;i<3;i++) assert.equal(typeof take("one"),"function","returned slots leave all three of the hour's sends");
  assert.equal(take("one"),null);
  for(let i=0;i<2;i++) assert.equal(typeof take("two"+i),"function","and leave the minute's shared sends to others");
  assert.equal(take("three"),null);
});

test("feedback endpoint validates requests and never calls Jira for rejected submissions",async()=>{
  let time=0,calls=0; const handler=createFeedbackHandler({guard:createFeedbackGuard(()=>time),send:async()=>{calls++;}});
  const req=(body,headers={})=>new Request("http://localhost:3000/api/feedback",{method:"POST",headers:{"content-type":"application/json",origin:"http://localhost:3000",...headers},body:JSON.stringify(body)});
  assert.equal((await handler(req({action:"open"},{origin:"https://evil.example"}),"account")).status,403);
  assert.equal((await handler(req({action:"open"},{"sec-fetch-site":"cross-site"}),"account")).status,403);
  assert.equal((await handler(req({message:"a".repeat(25000)}),"account")).status,413);
  const opened=await handler(req({action:"open"}),"account");
  assert.equal(opened.headers.get("set-cookie"),null,"the signed-in account identifies the sender, not a cookie");
  const {token}=await opened.json(); time+=1100;
  assert.equal((await handler(req({...feedback(" "),token,website:""}),"account")).status,400);
  assert.equal((await handler(req({...feedback("a".repeat(2001)),token,website:""}),"account")).status,400);
  assert.equal((await handler(req({...feedback(),token,website:""}),"another-account")).status,429,"a token works only for the account it was issued to");
  assert.equal(calls,0);
  const results=await Promise.all([handler(req({...feedback(),token,website:""}),"account"),handler(req({...feedback(),token,website:""}),"account")]);
  assert.deepEqual(results.map(x=>x.status).sort(),[200,429]); assert.equal(calls,1);
});

test("uncertain Jira delivery reports failure and consumes the token and the send, without false success or automatic retry",async(t)=>{
 const logged=t.mock.method(console,"error",()=>{});
 let time=0,calls=0; const handler=createFeedbackHandler({guard:createFeedbackGuard(()=>time),send:async()=>{calls++;throw new Error("upstream secret response");}});
 const request=(body)=>new Request("https://travel.example/api/feedback",{method:"POST",headers:{origin:"https://travel.example","content-type":"application/json"},body:JSON.stringify(body)});
 const send=async()=>{const {token}=await (await handler(request({action:"open"}),"account")).json();time+=1100;return {token,result:await handler(request({...feedback(),token,website:""}),"account")};};
 const {token,result}=await send();assert.equal(result.status,502);assert.deepEqual(await result.json(),{error:FEEDBACK_FAILURE});
 assert.equal((await handler(request({...feedback(),token,website:""}),"account")).status,429);assert.equal(calls,1);
 assert.deepEqual(logged.mock.calls.map((call)=>call.arguments),[["Feedback delivery failed."]],"an unexpected error's message may hold upstream data");
 for(let i=0;i<2;i++) assert.equal((await send()).result.status,502);
 assert.equal((await send()).result.status,429,"a send Jira may have created counts against the account's three an hour");
 assert.equal(calls,3);
});

test("each account gets ten tokens an hour, so one account can't use up everyone's",async()=>{
  const endpoint=feedbackEndpoint(async()=>created());
  for(let i=0;i<10;i++) assert.equal((await endpoint.open("busy")).status,200);
  const refusedOpen=await endpoint.open("busy");
  assert.equal(refusedOpen.status,429); assert.deepEqual(await refusedOpen.json(),{error:FEEDBACK_RETRY});
  assert.equal((await endpoint.send("quiet")).status,200,"another account still gets a token and sends");
  for(let i=0;i<9;i++) assert.equal((await endpoint.open("second")).status,200);
  assert.equal((await endpoint.open("third")).status,429,"everyone together still gets twenty tokens a minute");
  endpoint.clock.time+=60_000;
  assert.equal((await endpoint.open("third")).status,200);
  assert.equal((await endpoint.open("busy")).status,429);
  endpoint.clock.time+=3_600_000;
  assert.equal((await endpoint.open("busy")).status,200,"the account's tokens return after an hour");
});

test("a Jira outage answering 503 doesn't use up anyone's sends",async(t)=>{
  const logged=t.mock.method(console,"error",()=>{});
  let down=true,attempts=0;
  const endpoint=feedbackEndpoint(async()=>{attempts++;return down?new Response("Service Unavailable",{status:503}):created();});
  for(let i=0;i<5;i++) assert.equal((await endpoint.send("patient")).status,502);
  assert.equal(attempts,5,"more failures than the account's three an hour and everyone's five a minute");
  assert.deepEqual(new Set(logged.mock.calls.map((call)=>call.arguments[0])),new Set(["Feedback delivery failed: Jira answered HTTP 503."]));
  down=false;
  assert.equal((await endpoint.send("patient")).status,200);
  assert.equal((await endpoint.send("someone-else")).status,200);
  assert.equal(attempts,7);
});

test("credentials saved with a trailing line break still sign in to Jira",async()=>{
  let authorization="";
  const endpoint=feedbackEndpoint(async(_,options)=>{authorization=options.headers.Authorization;return created();},{...env,JIRA_URL:" http://127.0.0.1:3010\n",JIRA_EMAIL:"stand-in@example.test\n",JIRA_API_TOKEN:"test-token\r\n"});
  assert.equal((await endpoint.send("account")).status,200);
  assert.equal(authorization,basic);
});

test("failed sends log a fixed reason and Jira's status, never credentials or what Jira sent",async(t)=>{
  const logged=t.mock.method(console,"error",()=>{});
  const reasons=[
    [env,401,"Feedback delivery failed: Jira answered HTTP 401; check JIRA_EMAIL and JIRA_API_TOKEN."],
    [env,403,"Feedback delivery failed: Jira answered HTTP 403; the Jira account needs permission to create Tasks in TRA."],
    [env,400,"Feedback delivery failed: Jira answered HTTP 400."],
    [{...env,JIRA_URL:"http://stand-in:secret@127.0.0.1:3010"},201,"Feedback delivery failed: Invalid JIRA_URL setting."],
    [{...env,JIRA_EMAIL:""},201,"Feedback delivery failed: Missing feedback settings: JIRA_EMAIL"],
  ];
  for(const [settings,status,reason] of reasons) {
    const endpoint=feedbackEndpoint(async()=>new Response(JSON.stringify({errorMessages:["upstream secret detail"]}),{status}),settings);
    const result=await endpoint.send("account");
    assert.equal(result.status,502); assert.deepEqual(await result.json(),{error:FEEDBACK_FAILURE});
    assert.equal(logged.mock.calls.at(-1).arguments.join(" "),reason);
  }
  assert.doesNotMatch(logged.mock.calls.flatMap((call)=>call.arguments).join("\n"),/secret|test-token|stand-in@example/);
});
