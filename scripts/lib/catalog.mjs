/**
 * ACL4SSR catalog helpers: filename → profile id, URL join.
 */

/**
 * @param {string} filename e.g. ACL4SSR_Online_Full.ini
 * @returns {string} e.g. online_full
 */
export function filenameToId(filename) {
  let base = filename.replace(/\.ini$/i, '');
  if (/^ACL4SSR$/i.test(base)) return 'acl4ssr';
  base = base.replace(/^ACL4SSR_/i, '');
  return base
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .replace(/__+/g, '_')
    .toLowerCase();
}

/**
 * @param {string} base no trailing slash
 * @param {string} filename
 */
export function joinIniUrl(base, filename) {
  return `${base.replace(/\/$/, '')}/${filename}`;
}

/**
 * Expand catalog yaml object into profile stubs.
 * @param {{ base: string, files: string[] }} catalog
 * @returns {Array<{ id: string, name: string, filename: string, ini_url: string, source: string }>}
 */
export function expandCatalog(catalog) {
  const base = catalog.base;
  const files = catalog.files || [];
  return files.map((filename) => ({
    id: filenameToId(filename),
    name: filename.replace(/\.ini$/i, ''),
    filename,
    ini_url: joinIniUrl(base, filename),
    source: 'acl4ssr-catalog',
    enabled: true,
  }));
}
