// AmbientLayer.tsx — mount once in App.
export function AmbientLayer() {
  return (
    <>
      <div className="ambient-blob ambient-blob--brass" aria-hidden />
      <div className="ambient-blob ambient-blob--ink" aria-hidden />
    </>
  );
}
