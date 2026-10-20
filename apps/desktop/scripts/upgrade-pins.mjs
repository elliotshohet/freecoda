import assert from 'node:assert/strict';

// Public asset identities reviewed from the canonical GitHub releases. Changing
// the requested pair requires reviewing new binaries, never trusting a moving feed.
const pins = {
  '0.1.10->0.1.11': {
    linux: { from: 'sha256:9ebf4dc67b4c098acf22bb46a515187e9756b9c09f98bb7385b6cdd628cd3617', to: 'sha256:e1ad6d4cecf174f68f83c4dd2569444d223c792a68a1a0e85fe066554ebed633' },
    win32: { from: 'sha256:c36776f76a124ae8e8de1aa564702cb7d89025befd2d0b838290b2fb7abcd2b9', to: 'sha256:a7f76a82da7ced49412bea171e05ca2dc80ee8cd7a780b0ed485fcf5a4f1ff8b' },
  },
  '0.1.9->0.1.10': {
    linux: { from: 'sha256:bfb958f1419775602fca97040e2cefad412e650bcd05e7658b97eee7ff070377', to: 'sha256:9ebf4dc67b4c098acf22bb46a515187e9756b9c09f98bb7385b6cdd628cd3617' },
    win32: { from: 'sha256:767850e70e3e50ab5dfa4fdb24a7adbf19ac9b8145ad43d9f961ac98d4d956ba', to: 'sha256:c36776f76a124ae8e8de1aa564702cb7d89025befd2d0b838290b2fb7abcd2b9' },
  },
  '0.1.8->0.1.9': {
    linux: { from: 'sha256:2d47cfe7861131f86fccbd6750dedb45660be6740aa998b35c4f945137675c45', to: 'sha256:bfb958f1419775602fca97040e2cefad412e650bcd05e7658b97eee7ff070377' },
    win32: { from: 'sha256:50c068f196a52d0481423faae41c5617829c70b7989c410317f013b72d277bb0', to: 'sha256:767850e70e3e50ab5dfa4fdb24a7adbf19ac9b8145ad43d9f961ac98d4d956ba' },
  },
  '0.1.7->0.1.8': {
    linux: {
      from: 'sha256:1e525059b27b6daf8bf58115b6e6b2e65c36d57eea5ed8875224af07bc87c124',
      to: 'sha256:2d47cfe7861131f86fccbd6750dedb45660be6740aa998b35c4f945137675c45',
    },
    win32: {
      from: 'sha256:651f8fe8f46bedcf675c14413dc62d61a162f4a5a5cd7bc60b13cf917a4e1ecd',
      to: 'sha256:50c068f196a52d0481423faae41c5617829c70b7989c410317f013b72d277bb0',
    },
  },
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
