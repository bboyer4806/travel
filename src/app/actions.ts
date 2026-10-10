"use server";
import { revalidatePath } from "next/cache";
import { applyMutation, ValidationError } from "@/lib/store";
import { ImageValidationError, prepareDestinationImage } from "@/lib/destination-image-upload";
import type { ActionResult, Mutation } from "@/lib/types";

// Version one is intentionally a shared, publicly editable planner.
// Next.js Server Actions enforce same-origin requests; all input is validated in the store.
export async function mutatePlanner(input: Mutation, imageForm?: FormData): Promise<ActionResult> {
  try {
    // Never accept image bytes directly from the client mutation. Decode uploaded files first.
    const mutation = input.type === "destination.save"
      ? { ...input, image: await prepareDestinationImage(imageForm) }
      : input;
    const result = applyMutation(mutation);
    if (input.type === "trip.delete") revalidatePath("/"); else revalidatePath("/", "layout");
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ImageValidationError) return { ok: false, error: error.message };
    console.error("Unable to save travel plan", error);
    return { ok: false, error: "We couldn't save your changes. Please try again." };
  }
}