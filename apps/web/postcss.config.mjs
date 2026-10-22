import { fileURLToPath } from "node:url";

export default {
  plugins: {
    "@tailwindcss/postcss": {},
    // Next retains route styles after navigation. Keep generated utilities local,
    // including on the admin class attached to portaled sheets and tooltips.
    [fileURLToPath(new URL("./postcss-admin-scope.cjs", import.meta.url))]: {},
  },
};
