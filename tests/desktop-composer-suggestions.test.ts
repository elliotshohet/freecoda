import { expect, test } from "bun:test";
import { canAcceptSuggestion } from "../apps/desktop/src/renderer/composer-suggestions";

test("Tab suggestions require the unchanged draft and collapsed end cursor", () => {
  expect(canAcceptSuggestion("Review ", "Review ", "the changes", 7, 7)).toBe(true);
  expect(canAcceptSuggestion("", "", "Explain this function", 0, 0)).toBe(true);
  expect(canAcceptSuggestion("Review new text", "Review ", "the changes", 15, 15)).toBe(false);
  expect(canAcceptSuggestion("Review ", "Review ", "the changes", 2, 2)).toBe(false);
  expect(canAcceptSuggestion("Review ", "Review ", "the changes", 0, 7)).toBe(false);
  expect(canAcceptSuggestion("/delete", "/delete", " something", 7, 7)).toBe(false);
  expect(canAcceptSuggestion("Text", "Text", "", 4, 4)).toBe(false);
});
