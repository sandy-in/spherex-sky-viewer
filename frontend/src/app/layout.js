import "./globals.css";

export const metadata = {
  title: "SPHEREx Sky Viewer",
  description: "Explore the infrared universe and spot moving objects.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-gray-900 text-white antialiased">
        {children}
      </body>
    </html>
  );
}