import assert from "node:assert/strict";
import test from "node:test";
import { feedbackIssue, validateFeedback, FEEDBACK_FAILURE } from "../src/lib/feedback.ts";
import { createFeedbackGuard, sameOriginFeedback } from "../src/lib/feedback-guard.ts";
import { createFeedbackHandler } from "../src/lib/feedback-handler.ts";
import { sendJiraFeedback } from "../src/lib/jira-feedback.ts";

const feedback = (message="A useful improvement")=>({message,page:"/trips/demo?tab=budget",browser:"Test browser",viewport:"390 × 844"});
const env={NODE_ENV:"test",JIRA_URL:"http://127.0.0.1:3010",JIRA_EMAIL:"stand-in@example.test",JIRA_API_TOKEN:"test-token"};
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
    assert.equal(options.headers.Authorization,"Basic "+Buffer.from("stand-in@example.test:test-token").toString("base64"));
    assert.deepEqual(JSON.parse(options.body),feedbackIssue(feedback()));
    return Response.json({id:"1",key:"TRA-STUB"},{status:201});
  }});
  assert.equal(calls,1);
  for(const status of [200,302,400,401,429,500]) {
    let attempts=0; await assert.rejects(sendJiraFeedback(feedback(),{env,fetch:async()=>{attempts++;return new Response("failure",{status});}})); assert.equal(attempts,1);
  }
  await assert.rejects(sendJiraFeedback(feedback(),{env,fetch:async()=>Response.json({},{status:201})}),/incomplete/);
  await assert.rejects(sendJiraFeedback(feedback(),{env:{}}),/JIRA_URL, JIRA_EMAIL, JIRA_API_TOKEN/);
  await assert.rejects(sendJiraFeedback(feedback(),{env:{...env,JIRA_URL:"https://example.atlassian.net"}}),/stand-in/);
  const keepAlive=setTimeout(()=>{},500);
  try { await assert.rejects(sendJiraFeedback(feedback(),{env,timeoutMs:10,fetch:async(_,options)=>new Promise((_,reject)=>options.signal.addEventListener("abort",()=>reject(options.signal.reason)))}),/timeout/i); }
  finally {clearTimeout(keepAlive);}
});

test("invisible protection rejects replay, bot fields, too-fast sends and reset-cookie bursts",()=>{
  let time=0; const guard=createFeedbackGuard(()=>time);
  let token=guard.issue("one"); assert.equal(guard.consume("one",token,""),false);
  token=guard.issue("one"); time+=1100; assert.equal(guard.consume("other",token,""),false); assert.equal(guard.consume("one",token,"spam"),false);
  for(let i=0;i<3;i++){token=guard.issue("one");time+=1100;assert.equal(guard.consume("one",token,""),true);assert.equal(guard.consume("one",token,""),false);}
  token=guard.issue("one");time+=1100;assert.equal(guard.consume("one",token,""),false);
  for(let i=0;i<2;i++){token=guard.issue("fresh"+i);time+=1100;assert.equal(guard.consume("fresh"+i,token,""),true);}
  token=guard.issue("another-cookie");time+=1100;assert.equal(guard.consume("another-cookie",token,""),false,"aggregate per-minute cap does not depend on IP/cookie honesty");
  time+=3600001; token=guard.issue("one");time+=1100;assert.equal(guard.consume("one",token,""),true);
  token=guard.issue("expiry");time+=16*60000;assert.equal(guard.consume("expiry",token,""),false);
});

test("feedback endpoint validates requests and never calls Jira for rejected submissions",async()=>{
  let time=0,calls=0; const handler=createFeedbackHandler({guard:createFeedbackGuard(()=>time),send:async()=>{calls++;}});
  const req=(body,cookie="",headers={})=>new Request("http://localhost:3000/api/feedback",{method:"POST",headers:{"content-type":"application/json",origin:"http://localhost:3000",cookie,...headers},body:JSON.stringify(body)});
  assert.equal((await handler(req({action:"open"},"",{origin:"https://evil.example"}))).status,403);
  assert.equal((await handler(req({action:"open"},"",{"sec-fetch-site":"cross-site"}))).status,403);
  assert.equal((await handler(req({message:"a".repeat(25000)}))).status,413);
  const opened=await handler(req({action:"open"})); const cookie=opened.headers.get("set-cookie").split(";")[0];
  const {token}=await opened.json(); time+=1100;
  assert.equal((await handler(req({...feedback(" "),token,website:""},cookie))).status,400);
  assert.equal((await handler(req({...feedback("a".repeat(2001)),token,website:""},cookie))).status,400);
  assert.equal(calls,0);
  const results=await Promise.all([handler(req({...feedback(),token,website:""},cookie)),handler(req({...feedback(),token,website:""},cookie))]);
  assert.deepEqual(results.map(x=>x.status).sort(),[200,429]); assert.equal(calls,1);
});

test("uncertain Jira delivery reports failure and consumes the token, without false success or automatic retry",async()=>{
 let time=0,calls=0; const handler=createFeedbackHandler({guard:createFeedbackGuard(()=>time),send:async()=>{calls++;throw new Error("upstream secret response");}});
 const request=(body,cookie="")=>new Request("https://travel.example/api/feedback",{method:"POST",headers:{origin:"https://travel.example","content-type":"application/json",cookie},body:JSON.stringify(body)});
 const opened=await handler(request({action:"open"}));const cookie=opened.headers.get("set-cookie").split(";")[0];const {token}=await opened.json();time+=1100;
 const result=await handler(request({...feedback(),token,website:""},cookie));assert.equal(result.status,502);assert.deepEqual(await result.json(),{error:FEEDBACK_FAILURE});
 assert.equal((await handler(request({...feedback(),token,website:""},cookie))).status,429);assert.equal(calls,1);
});
