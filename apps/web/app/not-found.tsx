import Link from "next/link";
export default function NotFound() {
  return (
    <main className="page-shell prose" id="main">
      <h1>Nothing here yet.</h1>
      <p>This page doesn’t exist. Your next idea still can.</p>
      <Link className="button purple" href="/">
        Back to Freecoda
      </Link>
    </main>
  );
}
