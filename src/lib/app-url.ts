// The origin outbound links are built from: verification and alert emails,
// and the Google OAuth redirect. NEXT_PUBLIC_APP_URL is the deliberate answer;
// VERCEL_URL, which Vercel sets on every deployment, is the one that keeps a
// deploy that forgot it linking to itself instead of to a developer's laptop.

let warned = false;

export function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return trimSlash(configured);

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${trimSlash(vercel).replace(/^https?:\/\//, "")}`;

  // Nothing here can produce a link anyone else could follow. It is not worth
  // failing the send over, but it must not pass silently either.
  if (process.env.NODE_ENV === "production" && !warned) {
    warned = true;
    console.warn(
      "[afya] neither NEXT_PUBLIC_APP_URL nor VERCEL_URL is set: links in emails and the OAuth redirect fall back to http://localhost:3000.",
    );
  }
  return "http://localhost:3000";
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
