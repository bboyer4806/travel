"use client";
export default function ErrorPage({ retry }: { retry: () => void }) {
  return <main style={{maxWidth:640,margin:"15vh auto",padding:24}}>
    <p>TRAVEL NOTEBOOK</p><h1>We couldn&apos;t load your plans.</h1>
    <p>Please try again in a moment. If this keeps happening, the planner&apos;s storage may need attention.</p>
    <button onClick={retry}>Try again</button>
  </main>;
}
