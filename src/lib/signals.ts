/**
 * Requests passed through the window between parts of the app that do
 * not import each other (the viewers are separate chunks, loaded on
 * demand): the right-click menu on a selection asks the viewer on top
 * to act on it.
 */

/** Find a text in the open document. `detail` is the text. */
export const FIND_EVENT = "paperwren-find";
/** Select the whole of the open document. */
export const SELECT_ALL_EVENT = "paperwren-select-all";
