"use server";
import { redirect } from "next/navigation";
import { endSession } from "@/auth";

export async function signOutOfTravel() {
  await endSession();
  redirect("/login");
}
