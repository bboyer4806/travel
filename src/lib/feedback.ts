export const FEEDBACK_LIMIT = 2000;
export const FEEDBACK_FAILURE = "Couldn't send your feedback. Try again.";
export const FEEDBACK_RETRY = "Feedback is temporarily unavailable. Please try again later.";

export interface FeedbackInput { message: string; page: string; browser: string; viewport: string; }

export function validateFeedback(input: unknown): FeedbackInput {
  if (!input || typeof input !== "object") throw new Error("Enter your feedback");
  const data = input as Record<string, unknown>;
  if (typeof data.message !== "string") throw new Error("Enter your feedback");
  const message = data.message.replace(/\r\n?/g, "\n").trim();
  if (!message) throw new Error("Enter your feedback");
  if (message.length > FEEDBACK_LIMIT) throw new Error("Feedback must be 2,000 characters or fewer.");
  const context = (key: string, max: number) => typeof data[key] === "string" ? (data[key] as string).slice(0, max) : "";
  const page = context("page", 2048);
  if (!page.startsWith("/") || page.startsWith("//")) throw new Error("The feedback page is invalid. Reopen feedback and try again.");
  return { message, page, browser: context("browser", 1024), viewport: context("viewport", 40) };
}

export function feedbackIssue(input: FeedbackInput) {
  const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  return { fields: {
    project: { key: "TRA" }, issuetype: { name: "Task" }, labels: ["user-feedback"],
    summary: "Feedback: " + Array.from(input.message.split("\n")[0].trim()).slice(0, 80).join(""),
    description: { type: "doc", version: 1, content: [
      ...input.message.split("\n").map((line) => line ? paragraph(line) : { type: "paragraph", content: [] }),
      paragraph("Page: " + input.page), paragraph("Browser: " + input.browser), paragraph("Window: " + input.viewport),
    ] },
  } };
}
