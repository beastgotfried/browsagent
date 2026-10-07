/**
 * A component whose root is a fragment.
 *
 * There is no element to hold data-component, so the finder must walk up to
 * the nearest stamped ancestor. This file tests that path.
 */
export function Frag(): JSX.Element {
  return (
    <>
      <p className="panel__body">This text sits inside a fragment root.</p>
      <p className="panel__body">A second line in the same fragment.</p>
    </>
  );
}
