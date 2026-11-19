// @ts-check
/**
 * sidecar-abi.mjs — el Node del sidecar y el addon de SQLite son del mismo ABI.
 *
 * El `.exe` del sidecar lleva dentro su propio Node (el `target` de pkg). El
 * addon nativo `better_sqlite3.node` va al lado, copiado tal como lo dejó
 * `npm install`: compilado para el ABI del Node con el que se instaló. Si los
 * dos no coinciden, el binario se construye sin queja y falla al abrir la
 * memoria en el equipo de quien lo instala.
 *
 * El ABI de los addons es el mismo dentro de una versión mayor de Node, así
 * que basta con dos comprobaciones: que este script corre con la misma mayor
 * que la del sidecar, y que el addon carga aquí.
 *
 * La versión mayor se fija en `.node-version`, en la raíz; un test
 * (`scripts/node-version.test.mjs`) comprueba que este archivo, `engines` y
 * los workflows dicen lo mismo.
 */

/** Versión mayor de Node que lleva dentro el sidecar. */
export const SIDECAR_NODE_MAJOR = 22;

/** Target de `@yao-pkg/pkg`: runtime embebido, sistema y arquitectura. */
export const PKG_TARGET = `node${String(SIDECAR_NODE_MAJOR)}-win-x64`;

/**
 * ¿Se puede empaquetar con este Node?
 *
 * @param {string} nodeVersion versión del Node en marcha (`process.versions.node`)
 * @returns {string | null} por qué no, o `null` si se puede
 */
export function checkBuildNode(nodeVersion) {
  const major = Number.parseInt(nodeVersion.split('.')[0] ?? '', 10);
  if (major === SIDECAR_NODE_MAJOR) return null;
  const sidecar = String(SIDECAR_NODE_MAJOR);
  return (
    `este script corre con Node ${nodeVersion === '' ? 'desconocido' : nodeVersion} y el sidecar lleva dentro Node ${sidecar}.\n` +
    'El addon de better-sqlite3 se compila para el Node con el que se instala, y el de otra ' +
    'versión mayor no carga en el binario.\n' +
    `Cambia a Node ${sidecar} (la versión de .node-version), ejecuta \`npm ci\` y repite.`
  );
}

/**
 * ¿Carga el addon en este Node? Con `checkBuildNode` pasado, que cargue aquí
 * significa que cargará en el sidecar.
 *
 * @param {string} bindingPath ruta del `better_sqlite3.node` que se va a copiar
 * @param {(path: string) => unknown} load cargador de módulos (`require`)
 * @returns {string | null} por qué no, o `null` si carga
 */
export function checkBindingLoads(bindingPath, load) {
  try {
    load(bindingPath);
    return null;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return (
      `${bindingPath} no carga con este Node: ${detail}\n` +
      'Lo normal es que `npm install` se hiciera con otra versión de Node. ' +
      'Ejecuta `npm rebuild better-sqlite3` (o `npm ci`) con este Node y repite.'
    );
  }
}
