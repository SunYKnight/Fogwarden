/** Content of the short-lived window Settings' "Identify" puts on each monitor. */
export function IdentifyScreen({ number, name }: { number: string; name: string }) {
  return (
    <div className="identify-screen">
      <span className="identify-number">{number}</span>
      <span>{name}</span>
    </div>
  );
}
