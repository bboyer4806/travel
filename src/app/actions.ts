"use server";
import { revalidatePath } from "next/cache";
import { applyMutation, ValidationError } from "@/lib/store";
import type { ActionResult, Mutation } from "@/lib/types";

// Version one is intentionally a shared, publicly editable planner.
// Next.js Server Actions enforce same-origin requests; all input is validated in the store.
export async function mutatePlanner(input: Mutation): Promise<ActionResult> {
  try {
    const result = applyMutation(input);
    if (input.type === "trip.delete") revalidatePath("/"); else revalidatePath("/", "layout");
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof ValidationError) return { ok: false, error: error.message };
    console.error("Unable to save travel plan", error);
    return { ok: false, error: "We couldn't save your changes. Please try again." };
  }
}
