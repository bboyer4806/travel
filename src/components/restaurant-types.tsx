import { RESTAURANT_TYPE_LABELS, RESTAURANT_TYPES, type RestaurantType } from "@/lib/types";
import styles from "./restaurant-types.module.css";

/**
 * A restaurant's types as labeled tags (TRA-36), or nothing when it has none. Spans, so a card that is a button can hold
 * them; inside one they read as part of its name.
 */
export function RestaurantTypeTags({ types, className }: { types: RestaurantType[]; className?: string }) {
  if (types.length === 0) return null;
  return <span role="list" className={className ? styles.tags + " " + className : styles.tags}>
    {types.map((type) => <span role="listitem" key={type} className={styles.tag}>{RESTAURANT_TYPE_LABELS[type]}</span>)}
  </span>;
}

/** A restaurant editor's types: one checkbox for each, so any number can be chosen, or none. */
export function RestaurantTypesField({ types, disabled }: { types: RestaurantType[]; disabled: boolean }) {
  return <fieldset className={"wide " + styles.picker}>
    <legend>Restaurant types</legend>
    <div className={styles.choices}>
      {RESTAURANT_TYPES.map((type) => <label key={type} className={styles.choice}>
        <input type="checkbox" name="restaurantTypes" value={type} defaultChecked={types.includes(type)} disabled={disabled} />{RESTAURANT_TYPE_LABELS[type]}
      </label>)}
    </div>
    <small className={styles.hint}>Choose any that apply, or none.</small>
  </fieldset>;
}
