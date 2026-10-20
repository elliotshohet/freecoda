import { expect, test } from "bun:test";
import { canAdmitUsageReservation, MAX_CONCURRENT_ZERO_COST_RESERVATIONS } from "../apps/web/lib/usage";

const model = "reflection/beam-free";
const pending = { status: "pending", source: "free", model, maxCostMicros: "0" };

test("verified zero-cost reservations admit exactly three concurrent requests", () => {
  expect(MAX_CONCURRENT_ZERO_COST_RESERVATIONS).toBe(3);
  for (const count of [0, 1, 2]) expect(canAdmitUsageReservation(model, 0, Array.from({ length: count }, () => ({ ...pending })))).toBe(true);
  for (const count of [3, 4]) expect(canAdmitUsageReservation(model, 0, Array.from({ length: count }, () => ({ ...pending })))).toBe(false);
});

test("parallel admission requires every outstanding reservation to retain its zero-cost proof", () => {
  for (const changed of [
    { status: "uncertain" }, { status: "settled" }, { source: "paid" },
    { model: "other/free" }, { maxCostMicros: 1 }, { maxCostMicros: "1" },
    { maxCostMicros: null }, { maxCostMicros: undefined }, { maxCostMicros: false },
    { maxCostMicros: "" }, { maxCostMicros: "0.0" }, { maxCostMicros: NaN },
  ]) {
    const unsafe = { ...pending, ...changed };
    expect(canAdmitUsageReservation(model, 0, [pending, unsafe])).toBe(false);
    expect(canAdmitUsageReservation(model, 0, [unsafe, pending])).toBe(false);
  }
  expect(canAdmitUsageReservation(model, 0, [{ ...pending, maxCostMicros: 0 }])).toBe(true);
});

test("paid or unknown-cost requests retain single-request admission and invalid amounts fail closed", () => {
  expect(canAdmitUsageReservation("fixture", 100, [])).toBe(true);
  expect(canAdmitUsageReservation("fixture", 100, [pending])).toBe(false);
  expect(canAdmitUsageReservation(model, 1, [pending])).toBe(false);
  for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(canAdmitUsageReservation(model, amount, [])).toBe(false);
    expect(canAdmitUsageReservation(model, amount, [pending])).toBe(false);
  }
  expect(canAdmitUsageReservation("unverified-model", 0, [])).toBe(false);
});
