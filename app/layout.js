export const dynamic = "force-dynamic";

export const metadata = {
  title: "Al Shrooouk Scan & Lab",
  description: "Staff Portal",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
