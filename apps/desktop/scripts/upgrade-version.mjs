/** Replacements retain their pathname but may have completely different ASAR headers. */
export function readInstalledVersion(asar, archive) {
  asar.uncache(archive);
  return JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8')).version;
}
