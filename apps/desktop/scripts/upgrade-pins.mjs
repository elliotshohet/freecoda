import assert from 'node:assert/strict';

// Public asset identities reviewed from the canonical GitHub releases. Changing
// the requested pair requires reviewing new binaries, never trusting a moving feed.
const pins = {
  '0.1.4->0.1.5': {
    linux: {
      from: 'sha256:070ca61fa3f5995c6f3d159faf9da89eb4ddd153c4f13c04434d165c906d799c',
      to: 'sha256:0f15ed35df2fee675fce5f1470aaf1a4f1afc4dfc2bec64b74606ce661f29d79',
    },
    win32: {
      from: 'sha256:d954d17620dbfe333b4285a943cc5eea6dc808db22c3ebd97923d14c1673569a',
      to: 'sha256:698931334dcc9fc2cd35a707ea787e326e343ddeda08de860b9a6c4bcfffde4e',
    },
  },
};
export function pinnedUpgrade(from, to, platform) {
  const pair = pins[`${from}->${to}`]?.[platform];
  assert(pair, `Unreviewed upgrade ${from} -> ${to} on ${platform}; review and pin the canonical release asset digests first.`);
  return pair;
}
