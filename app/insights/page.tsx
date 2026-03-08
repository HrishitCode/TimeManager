"use client";

import Link from "next/link";
import AuthGate from "@/components/AuthGate";
import InsightsPanel from "@/components/InsightsPanel";

function InsightsPageContent({ token, email }: { token: string; email: string }) {
  return (
    <main>
      <div className="card" style={{ marginBottom: 12 }}>
        <h1>Insights</h1>
        <p className="muted" style={{ marginTop: 4 }}>
          Signed in as {email}
        </p>
        <div style={{ marginTop: 10 }} className="row wrap">
          <Link href="/">
            <button className="ghost" type="button">
              Timer
            </button>
          </Link>
          <Link href="/calendar">
            <button className="ghost" type="button">
              Calendar
            </button>
          </Link>
        </div>
      </div>
      <InsightsPanel token={token} />
    </main>
  );
}

export default function InsightsPage() {
  return <AuthGate>{({ token, email }) => <InsightsPageContent token={token} email={email} />}</AuthGate>;
}
