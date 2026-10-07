import Link from "next/link";
export default function NotFound() {
  return <main style={{maxWidth:640,margin:"15vh auto",padding:24}}>
    <p>TRAVEL NOTEBOOK</p><h1>This page has moved on.</h1>
    <p>The trip or destination may have been removed. Your other ideas are still on the trips page.</p>
    <Link href="/">Back to trips</Link>
  </main>;
}
