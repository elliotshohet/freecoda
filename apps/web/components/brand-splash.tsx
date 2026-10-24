import styles from "./brand-splash.module.css";

export function BrandSplash({ loading = false }: { loading?: boolean }) {
  return (
    <div className={styles.stage} data-loading={loading || undefined} role={loading ? "status" : undefined}>
      <div className={styles.halo} aria-hidden="true" />
      <div className={styles.orbit} aria-hidden="true" />
      <img className={styles.logo} src="/brand/freecoda-mark.svg" width="88" height="88" alt={loading ? "Loading Freecoda" : "Freecoda"} />
    </div>
  );
}
