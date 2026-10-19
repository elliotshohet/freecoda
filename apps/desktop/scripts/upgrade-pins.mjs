import assert from 'node:assert/strict';

// Public asset identities reviewed from the canonical GitHub releases. Changing
// the requested pair requires reviewing new binaries, never trusting a moving feed.
const pins = {
  '0.1.5->0.1.6': {
    linux: {
      from: 'sha256:0f15ed35df2fee675fce5f1470aaf1a4f1afc4dfc2bec64b74606ce661f29d79',
      to: 'sha256:6d01fbf6785c7ea4bd84487e3897af5de89796cbf181b1bbf447de6be4793d26',
    },
    win32: {
      from: 'sha256:698931334dcc9fc2cd35a707ea787e326e343ddeda08de860b9a6c4bcfffde4e',
      to: 'sha256:545690bf3ab55a4d409595bb308305e40189fa86d91eed71f38117ed83cf6ca9',
    },
  },
};
export function pinnedUpgrade(from, to, platform) {
  const pair = pins[`${from}->${to}`]?.[platform];
  assert(pair, `Unreviewed upgrade ${from} -> ${to} on ${platform}; review and pin the canonical release asset digests first.`);
  return pair;
}
