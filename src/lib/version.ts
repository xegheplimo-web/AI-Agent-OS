/* ------------------------------------------------------------------ */
/* Single source of truth for the application version.                 */
/*                                                                     */
/* Every place that surfaces a version (package.json, Cargo.toml,      */
/* tauri.conf.json, the auditor generator stamp, the artifact schema   */
/* default) must agree. Previously they drifted independently          */
/* (0.1.0 / 0.1.0 / 0.4.0 / 0.3.1), so the desktop shell, the Rust     */
/* crate, the generated SBOM and the stored artifacts all reported      */
/* different numbers for the same release. Keep this file in sync with */
/* `version` in package.json and Cargo.toml.                           */
/* ------------------------------------------------------------------ */

export const APP_VERSION = "0.5.0";

/** Stamp written into every generated artifact's `generatorVersion` and the
 *  DB column default, so a reconstructed SBOM/README always records which
 *  version of the auditor produced it. */
export const GENERATOR_VERSION = APP_VERSION;
