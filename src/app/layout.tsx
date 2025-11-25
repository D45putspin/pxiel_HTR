import type { Metadata } from "next";
import { Inter, Press_Start_2P } from "next/font/google";
import "./globals.css";

const inter = Inter({ 
  subsets: ["latin"],
  variable: "--font-inter"
});

const pixel = Press_Start_2P({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-pixel"
});

export const metadata: Metadata = {
  title: "pXiel - Collaborative Pixel Canvas",
  description: "Decentralized collaborative pixel art canvas built on the Hathor network",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.className} ${pixel.className}`}>
        <div id="__next">
          {children}
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              document.addEventListener('keydown', function(e){
                if(e.key === 'Enter') { window.location.href = '/dapp'; }
              });
            `,
          }}
        />
      </body>
    </html>
  );
}
