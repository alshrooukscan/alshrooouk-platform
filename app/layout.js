export const dynamic = "force-dynamic";

export const metadata = {
  // Spelled the way the logo does - ALSHROOUK, two o's. The app had been
  // carrying a third one that appears nowhere on the brand itself.
  title: "Alshroouk Lab & Scan",
  description: "Staff Portal",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
