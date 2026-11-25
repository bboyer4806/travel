import { Heart } from "lucide-react";
import type { Like } from "@/lib/types";
import styles from "./like-button.module.css";

/**
 * An item's Like (TRA-31): a heart, filled while the signed-in account likes the item and outlined while it doesn't,
 * beside how many accounts like it. Selecting it asks `onLike` to save the account's like, or remove it, at once. It
 * shows what is saved, so it changes only once the page shows a saved change, and a save that fails leaves it as it was.
 * Screen readers hear the item's name and the count, and whether it is pressed, which is whether the account likes it.
 */
export function LikeButton({ like, name, disabled, onLike }: { like: Like; name: string; disabled: boolean; onLike: (liked: boolean, control: HTMLButtonElement) => void }) {
  return <button type="button" className={styles.like} aria-pressed={like.liked} disabled={disabled} onClick={(event) => onLike(!like.liked, event.currentTarget)}>
    <Heart size={16} fill={like.liked ? "currentColor" : "none"} aria-hidden="true" />
    <span className="sr-only">Like {name}, </span>{like.count}<span className="sr-only">{like.count === 1 ? " like" : " likes"}</span>
  </button>;
}
