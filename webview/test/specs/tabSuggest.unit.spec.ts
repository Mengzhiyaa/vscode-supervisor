import { expect, test } from "@playwright/test";
import { isTabSuggestContext } from "../../src/console/tabSuggest";

test("tab suggest matches Positron's leading-text context", () => {
    expect(isTabSuggestContext("    pri", 8, false)).toBe(true);
    expect(isTabSuggestContext("call(", 6, false)).toBe(true);
    expect(isTabSuggestContext("value:", 7, false)).toBe(true);
    expect(isTabSuggestContext("    ", 5, false)).toBe(false);
    expect(isTabSuggestContext("print", 6, true)).toBe(false);
});
