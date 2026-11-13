/**
 * Why a save from a page opened before an update was refused: the planner no longer recognizes its action, or the save
 * lacks what this version needs, such as a new item's ID. Nothing was saved, and reloading the page fixes it.
 */
export const PLANNER_UPDATED = "The planner was updated. Your changes haven't been saved. Please reload the page and try again.";
